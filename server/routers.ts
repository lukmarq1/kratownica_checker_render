import { z } from "zod";
import { publicProcedure, router } from "./_core/trpc";
import mysql from "mysql2/promise";
import crypto from "crypto";

const MAX_ATTEMPTS = 2;
const BASE_LOCKOUT_MS = 24 * 60 * 60 * 1000;
const REPEAT_LOCKOUT_MS = 3 * 24 * 60 * 60 * 1000;
const COOKIE_NAME = "__Host-kratownica_did";
const CORRECT_ANGLE = 65;
const TOLERANCE = 2;
const ADMIN_PIN = process.env.ADMIN_PIN || "1234";
const GEO_PROVIDER_TIMEOUT_MS = 1300;

let pool: mysql.Pool | null = null;
function getPool(){ if(pool) return pool; const raw=process.env.DATABASE_URL; if(!raw) throw new Error("Brak DATABASE_URL"); const u=new URL(raw); pool=mysql.createPool({host:u.hostname,port:Number(u.port||3306),user:decodeURIComponent(u.username),password:decodeURIComponent(u.password),database:u.pathname.replace(/^\//,"")||"defaultdb",ssl:{rejectUnauthorized:false} as any,waitForConnections:true,connectionLimit:10}); return pool; }

let tablesEnsured = false;
async function ensureTable(){
  if(tablesEnsured) return;
  const p=getPool();
  await p.query(`CREATE TABLE IF NOT EXISTS lockouts (lock_key VARCHAR(255) PRIMARY KEY, failed_attempts INT NOT NULL DEFAULT 0, locked_until DATETIME NULL, last_attempt_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, is_subnet TINYINT(1) DEFAULT 0, INDEX idx_locked_until (locked_until))`);
  await p.query(`CREATE TABLE IF NOT EXISTS device_networks (fingerprint VARCHAR(255) PRIMARY KEY, first_ip VARCHAR(45) NOT NULL, first_subnet VARCHAR(45) NOT NULL, last_ip VARCHAR(45) NOT NULL, last_subnet VARCHAR(45) NOT NULL, updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP)`);
  await p.query(`CREATE TABLE IF NOT EXISTS attempt_logs (id INT AUTO_INCREMENT PRIMARY KEY, ip VARCHAR(45), subnet VARCHAR(45), angle INT, status ENUM('success','fail','locked','vpn') DEFAULT 'fail', browser VARCHAR(500), fingerprint VARCHAR(255), device_id VARCHAR(500), localization TEXT, created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, INDEX idx_created (created_at), INDEX idx_ip (ip), INDEX idx_fp (fingerprint))`);
  try{ await p.query(`ALTER TABLE attempt_logs MODIFY COLUMN localization TEXT`); }catch{}
  try{ await p.query(`ALTER TABLE attempt_logs MODIFY COLUMN browser VARCHAR(500)`); }catch{}
  try{ await p.query(`ALTER TABLE attempt_logs MODIFY COLUMN device_id VARCHAR(500)`); }catch{}
  try{ await p.query(`ALTER TABLE attempt_logs ADD COLUMN os VARCHAR(100) NULL`); }catch{}
  try{ await p.query(`ALTER TABLE attempt_logs MODIFY COLUMN os VARCHAR(100)`); }catch{}
  tablesEnsured = true;
}

function normalizeIp(ip:string){ if(!ip) return "0.0.0.0"; ip=ip.trim(); if(ip.startsWith("::ffff:")) ip=ip.slice(7); if(ip==="::1") return "127.0.0.1"; return ip; }
function getClientIp(req:any){
  const h:any=req?.headers||{};
  const get=(k:string)=>h[k]||h[k.toLowerCase()]||h[k.toUpperCase()];
  const xff=String(get("x-forwarded-for")||"");
  if(xff){ const parts=xff.split(",").map((s:string)=>s.trim()).filter(Boolean); const pub=parts.find(p=>{ const n=normalizeIp(p); return n &&!isPrivateIp(n) && n!=="0.0.0.0"; }); if(pub) return normalizeIp(pub); if(parts[0]) return normalizeIp(parts[0]); }
  const cands=[get("cf-connecting-ip"),get("x-real-ip"),get("true-client-ip")];
  for(const v of cands){ if(!v) continue; const ip=normalizeIp(String(Array.isArray(v)?v[0]:v)); if(ip && ip!=="0.0.0.0") return ip; }
  return normalizeIp(String(req?.ip||req?.socket?.remoteAddress||"0.0.0.0"));
}
function isIPv4(ip:string){ return /^\d+\.\d+\.\d+\.\d+$/.test(ip); }
function isPrivateIp(ip:string){ return ip==="127.0.0.1"||ip==="0.0.0.0"||ip.startsWith("10.")||ip.startsWith("192.168.")||/^172\.(1[6-9]|2\d|3[0-1])\./.test(ip); }
function getSubnet(ip:string){ ip=normalizeIp(ip); if(!isIPv4(ip)) return ip; return ip.split(".").slice(0,3).join("."); }
function getSubnetKey(ip:string){ return `subnet:${getSubnet(ip)}`; }
function isMullvadRange(ip:string){ return normalizeIp(ip).startsWith("185.132.178."); }
function getRawHeader(req:any, name:string):string{
  try{
    const h:any=req?.headers||{};
    let v = h[name] || h[name.toLowerCase()] || h[name.toUpperCase()];
    if(!v && typeof h.get==='function'){ try{ v=h.get(name)||h.get(name.toLowerCase()); }catch{} }
    if(Array.isArray(v)) v=v[0];
    return String(v||"").replace(/^"|"$/g,"").trim();
  }catch{ return ""; }
}
function parseOsFromUA(ua:string):string{
  if(!ua) return "";
  let s=String(ua).toLowerCase().replace(/"/g,"").trim();
  if(!s) return "";
  if(s.includes("windows nt 10")||s.includes("windows nt 11")||s.includes("windows")||s==="windows") return "Windows";
  if(s.includes("mac os x")||s.includes("macintosh")||s.includes("macos")||s==="macos"||s==="mac os") return "macOS";
  if(s.includes("android")||s==="android") return "Android";
  if(s.includes("iphone")||s.includes("ipad")||s.includes("ios")||s==="ios") return "iOS";
  if(s.includes("linux")||s==="linux") return "Linux";
  if(s.includes("cros")||s.includes("chrome os")||s==="chrome os") return "Chrome OS";
  return "";
}
function detectOs(req:any, fallbackBrowser?:string):string{
  // 1. explicit sec-ch-ua-platform (most reliable on modern Chrome)
  const plat = getRawHeader(req, "sec-ch-ua-platform") || getRawHeader(req, "Sec-CH-UA-Platform");
  const fromPlat = parseOsFromUA(plat);
  if(fromPlat) return fromPlat;
  // 2. full User-Agent
  const ua = getRawHeader(req, "user-agent") || getRawHeader(req, "User-Agent") || String(fallbackBrowser||"");
  const fromUA = parseOsFromUA(ua);
  if(fromUA) return fromUA;
  // 3. last resort - if browser is Chrome and no info, assume Windows (najczęstszy u Ciebie)
  return "";
}

// ===== ALERT V18D - Telegram + Resend (bez npm) =====
let _mailer:any=null;
async function getMailerDynamic(){
  try{
    const mod = await import("nodemailer").catch(()=>null) as any;
    if(!mod) return null;
    const nodemailer = mod.default || mod;
    const host=process.env.SMTP_HOST||process.env.MAIL_HOST||"";
    const port=parseInt(process.env.SMTP_PORT||process.env.MAIL_PORT||"587",10);
    const user=process.env.SMTP_USER||process.env.MAIL_USER||"";
    const pass=process.env.SMTP_PASS||process.env.MAIL_PASS||"";
    if(!host||!user||!pass) return null;
    if(_mailer) return _mailer;
    _mailer = nodemailer.createTransport({host,port,secure:port===465,auth:{user,pass}});
    return _mailer;
  }catch(e:any){ pushError('getMailerDynamic',e); return null; }
}
async function sendBlockEmail(opts:{ip:string, subnet:string, fingerprint:string, deviceId:string, browser?:string, os?:string, reason?:string, count?:number, geo?:any}){
  try{
    const to=(process.env.ALERT_EMAIL_TO||process.env.ADMIN_EMAIL||"").trim();
    if(!to) return;
    const from=(process.env.ALERT_EMAIL_FROM||process.env.SMTP_USER||`Kratownica <onboarding@resend.dev>`).trim();
    const now=new Date().toLocaleString('pl-PL',{timeZone:'Europe/Warsaw'});
    const subject=`[ALERT] Zablokowano ${opts.ip} - ${opts.reason||'przekroczono proby'}`;
    const html=`<div style="font-family:system-ui;background:#0f172a;color:#e2e8f0;padding:24px;border-radius:12px"><h2 style="color:#f87171">🚨 Zablokowano ${opts.ip}</h2><p>${now} | ${opts.reason}</p><p>Subnet ${opts.subnet} | FP ${opts.fingerprint} | Device ${opts.deviceId}</p><p><a href="${process.env.APP_URL||''}/admin" style="color:#38bdf8">Admin</a></p></div>`;
    const resendKey=process.env.RESEND_API_KEY;
    if(resendKey){
      try{ const r=await fetch("https://api.resend.com/emails",{method:"POST",headers:{Authorization:`Bearer ${resendKey}`,"Content-Type":"application/json"},body:JSON.stringify({from,to:[to],subject,html})}); if(r.ok) return; }catch{}
    }
    const mailer=await getMailerDynamic(); if(mailer){ await mailer.sendMail({from,to,subject,html}); }
  }catch(e:any){ pushError('sendBlockEmail',e); }
}
async function sendTelegramBlock(opts:{ip:string, subnet:string, fingerprint:string, deviceId:string, browser?:string, os?:string, reason?:string, count?:number, geo?:any}){
  try{
    const token=(process.env.TELEGRAM_BOT_TOKEN||"").trim();
    const chatId=(process.env.TELEGRAM_CHAT_ID||"").trim();
    if(!token||!chatId) return false;
    const now=new Date().toLocaleString('pl-PL',{timeZone:'Europe/Warsaw'});
    const appUrl=(process.env.APP_URL||'https://kratownica-checker-render.onrender.com').replace(/\/$/,"");
    const msg=`🚨 <b>ZABLOKOWANO</b>\n\n<b>IP:</b> <code>${opts.ip}</code>\n<b>Subnet:</b> <code>${opts.subnet}</code>\n<b>Powód:</b> ${opts.reason||'MAX_ATTEMPTS'}\n<b>Próby:</b> ${opts.count||'?'} \n<b>Czas:</b> ${now}\n\n<b>FP:</b> <code>${(opts.fingerprint||'').slice(0,20)}...</code>\n<b>Browser:</b> ${opts.browser||'?'} / ${opts.os||'?'} \n\n<a href="${appUrl}/admin">👉 Otwórz Panel</a>`;
    const r=await fetch(`https://api.telegram.org/bot${token}/sendMessage`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({chat_id:chatId,text:msg,parse_mode:"HTML",disable_web_page_preview:true,reply_markup:{inline_keyboard:[[{text:"🔓 Otwórz Admin",url:`${appUrl}/admin`}]]}})});
    return r.ok;
  }catch(e:any){ pushError('sendTelegramBlock',e); return false; }
}


function parseCookies(req:any):Record<string,string>{ const h=req.headers?.cookie||""; const o:Record<string,string>={}; h.split(";").forEach((p:string)=>{const [k,...v]=p.trim().split("="); if(k) o[k]=decodeURIComponent(v.join("="));}); return o; }
function ensureDoubleCookie(ctx:any,id?:string){ const c=parseCookies(ctx.req); let cid=c[COOKIE_NAME]; let did=id || (ctx.req.headers?.["x-device-id"] as string) || cid; if(!cid){ cid=did||crypto.randomUUID(); try{ ctx.res?.setHeader?.("Set-Cookie",`${COOKIE_NAME}=${cid}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${60*60*24*365}`);}catch{} } if(!did) did=cid; return {deviceId:did!,cookieId:cid!}; }

type NormGeo = {country:string; city:string; zip:string; timezone:string; isp:string; org:string; as:string; lat:number|null; lon:number|null; query:string; regionName:string};

function emptyGeo(ip:string):NormGeo{ return {country:"",city:"",zip:"",timezone:"",isp:"",org:"",as:"",lat:null,lon:null,query:ip,regionName:""}; }

const geoProviders: {name:string; url:(ip:string)=>string; parse:(j:any, ip:string)=>NormGeo|null}[] = [
  {
    name: "ip.sb",
    url: (ip)=>`https://api.ip.sb/geoip/${ip}`,
    parse: (j, ip)=>{ if(!j?.country) return null; return {country:j.country_code||j.country, city:j.city||"", zip:"", timezone:j.timezone||"", isp:j.isp||j.organization||"", org:j.organization||"", as:j.asn?String(j.asn):"", lat:j.latitude??null, lon:j.longitude??null, query:ip, regionName:j.region||""}; }
  },
  {
    name: "geojs",
    url: (ip)=>`https://get.geojs.io/v1/ip/geo/${ip}.json`,
    parse: (j, ip)=>{ if(!j?.country) return null; return {country:j.country_code||j.country, city:j.city||"", zip:"", timezone:j.timezone||"", isp:j.organization_name||j.organization||"", org:j.organization_name||"", as:j.asn?String(j.asn):"", lat:j.latitude?Number(j.latitude):null, lon:j.longitude?Number(j.longitude):null, query:ip, regionName:j.region||""}; }
  },
  {
    name: "freeipapi",
    url: (ip)=>`https://freeipapi.com/api/json/${ip}`,
    parse: (j, ip)=>{ if(!j?.countryName && !j?.countryCode) return null; return {country:j.countryCode||j.countryName, city:j.cityName||"", zip:j.zipCode||"", timezone:j.timeZone||"", isp:"", org:"", as:"", lat:j.latitude??null, lon:j.longitude??null, query:ip, regionName:j.regionName||""}; }
  },
  {
    name: "ipinfo",
    url: (ip)=>`https://ipinfo.io/${ip}/json`,
    parse: (j, ip)=>{ if(!j?.country) return null; let lat:number|null=null, lon:number|null=null; if(typeof j.loc==="string" && j.loc.includes(",")){ const [a,b]=j.loc.split(","); lat=Number(a); lon=Number(b); } const orgRaw=j.org||""; const isp=orgRaw.replace(/^AS\d+\s*/,""); return {country:j.country, city:j.city||"", zip:j.postal||"", timezone:j.timezone||"", isp:isp||orgRaw, org:orgRaw, as:(orgRaw.match(/^AS\d+/)||[""])[0], lat, lon, query:ip, regionName:j.region||""}; }
  },
  {
    name: "ipwho.is",
    url: (ip)=>`https://ipwho.is/${ip}`,
    parse: (j, ip)=>{ if(j?.success===false || !j?.country) return null; return {country:j.country_code||j.country, city:j.city||"", zip:j.postal||"", timezone:j.timezone?.id||j.timezone||"", isp:j.connection?.isp||j.isp||j.connection?.org||"", org:j.connection?.org||"", as:j.connection?.asn?String(j.connection.asn):"", lat:j.latitude??null, lon:j.longitude??null, query:ip, regionName:j.region||""}; }
  },
  {
    name: "ipapi.co",
    url: (ip)=>`https://ipapi.co/${ip}/json/`,
    parse: (j, ip)=>{ if(!j?.country_name && !j?.country_code) return null; return {country:j.country_code||j.country_name, city:j.city||"", zip:j.postal||"", timezone:j.timezone||"", isp:j.org||"", org:j.org||"", as:j.asn||"", lat:j.latitude??null, lon:j.longitude??null, query:ip, regionName:j.region||""}; }
  },
  {
    name: "ip-api.com",
    url: (ip)=>`https://ip-api.com/json/${ip}?fields=status,country,countryCode,city,zip,timezone,isp,org,as,lat,lon,query,regionName`,
    parse: (j, ip)=>{ if(j?.status!=="success") return null; return {country:j.countryCode||j.country, city:j.city||"", zip:j.zip||"", timezone:j.timezone||"", isp:j.isp||j.org||"", org:j.org||"", as:j.as||"", lat:j.lat??null, lon:j.lon??null, query:ip, regionName:j.regionName||""}; }
  },
];

const geoCache = new Map<string, any>();
function mergeGeo(base:NormGeo, add:NormGeo):NormGeo{
  if(!base) return add;
  if(!add) return base;
  return {
    country: base.country || add.country,
    city: base.city || add.city,
    zip: base.zip || add.zip,
    timezone: base.timezone || add.timezone,
    isp: base.isp || add.isp,
    org: base.org || add.org,
    as: base.as || add.as,
    lat: base.lat ?? add.lat,
    lon: base.lon ?? add.lon,
    query: base.query || add.query,
    regionName: base.regionName || add.regionName,
  };
}
async function fetchGeoFast(ip:string, req?:any){
  ip=normalizeIp(ip);
  if(geoCache.has(ip)) return geoCache.get(ip);
  if(!isIPv4(ip)) return null;
  if(isPrivateIp(ip)){ const g={country:"Local",city:"LAN",isp:"Private",query:ip,lat:null,lon:null} as any; geoCache.set(ip,g); return g; }

  let acc: NormGeo | null = null;
  for(const provider of geoProviders){
    try{
      const ctrl=new AbortController();
      const t=setTimeout(()=>ctrl.abort(),GEO_PROVIDER_TIMEOUT_MS);
      const res=await fetch(provider.url(ip),{signal:ctrl.signal,headers:{"User-Agent":"kratownica/1.0","Accept":"application/json"}} as any);
      clearTimeout(t);
      if(!res.ok) continue;
      const j=await res.json() as any;
      const parsed=provider.parse(j, ip);
      if(parsed && parsed.country){
        if(!parsed.isp && isMullvadRange(ip)) parsed.isp="Mullvad VPN";
        if(!acc) acc = parsed;
        else acc = mergeGeo(acc, parsed);
        const hasEnough = acc.country && acc.city && acc.zip && acc.timezone && acc.isp && acc.lat!=null;
        if(hasEnough) break;
      }
    }catch{ }
  }
  if(acc){ geoCache.set(ip,acc); return acc; }

  try{
    const h=req?.headers||{};
    const cc=h["cf-ipcountry"]||h["x-country"];
    if(cc && cc!=="XX" && cc!=="T1"){
      const g:NormGeo={
        country:String(cc),
        city:String(h["cf-ipcity"]||h["x-city"]||""),
        zip:"",
        timezone:String(h["cf-timezone"]||""),
        isp: isMullvadRange(ip) ? "Mullvad VPN" : "",
        org:"",
        as:"",
        lat:h["cf-iplatitude"]?Number(h["cf-iplatitude"]):null,
        lon:h["cf-iplongitude"]?Number(h["cf-iplongitude"]):null,
        query:ip,
        regionName:""
      };
      geoCache.set(ip,g);
      return g;
    }
  }catch{}

  const fallback=emptyGeo(ip);
  if(isMullvadRange(ip)) fallback.isp="Mullvad VPN";
  fallback.country = fallback.country || "";
  (fallback as any).note = "geo blocked";
  geoCache.set(ip,fallback);
  return fallback;
}

async function getRecord(key:string){ await ensureTable(); const [rows]=await getPool().query<any[]>(`SELECT failed_attempts, locked_until FROM lockouts WHERE lock_key=?`,[key]); return (rows as any[])[0]||null; }
async function getRemainingMax(keys:string[]){ if(!keys.length) return 0; const now=Date.now(); const vals=await Promise.all(keys.map(k=>getRecord(k).then(r=>{ if(!r?.locked_until) return 0; return Math.max(0,new Date(r.locked_until).getTime()-now); }).catch(()=>0))); return Math.max(0,...vals); }
async function getRepeatDuration(fp:string,ip:string){ try{ const p=getPool(); if(fp){ const [dn]=await p.query<any[]>(`SELECT first_ip,last_ip FROM device_networks WHERE fingerprint=?`,[fp]); const d=(dn as any[])[0]; if(d && d.first_ip!==d.last_ip) return REPEAT_LOCKOUT_MS; } }catch{} return BASE_LOCKOUT_MS; }
async function lockKeys(keys:string[],fp?:string,ip?:string){ if(!keys.length) return BASE_LOCKOUT_MS; await ensureTable(); const p=getPool(); const dur=await getRepeatDuration(fp||"",ip||""); const until=new Date(Date.now()+dur); await Promise.all(keys.map(k=>p.query(`INSERT INTO lockouts (lock_key,failed_attempts,locked_until,last_attempt_at,is_subnet) VALUES (?,?,?,NOW(),?) ON DUPLICATE KEY UPDATE failed_attempts=VALUES(failed_attempts), locked_until=VALUES(locked_until), last_attempt_at=NOW()`,[k,MAX_ATTEMPTS,until,k.startsWith("subnet:")?1:0]).catch(()=>{}))); return dur; }
async function incrementFail(keys:string[],fp?:string,ip?:string){ if(!keys.length) return {locked:false,duration:BASE_LOCKOUT_MS}; await ensureTable(); const recs=await Promise.all(keys.map(k=>getRecord(k).catch(()=>null))); const shouldLock=recs.some(r=>((r?.failed_attempts||0)+1)>=MAX_ATTEMPTS); if(shouldLock){ const d=await lockKeys(keys,fp,ip); return {locked:true,duration:d}; } const p=getPool(); await Promise.all(keys.map(async k=>{ const r=recs[keys.indexOf(k)]; const fails=(r?.failed_attempts||0)+1; await p.query(`INSERT INTO lockouts (lock_key,failed_attempts,last_attempt_at) VALUES (?,?,NOW()) ON DUPLICATE KEY UPDATE failed_attempts=?, last_attempt_at=NOW()`,[k,fails,fails]).catch(()=>{}); })); return {locked:false,duration:BASE_LOCKOUT_MS}; }
const lastErrors: Array<{ts:string,where:string,msg:string,stack?:string}> = [];
function pushError(where:string, err:any){ try{ const m=err?.message||String(err); const e={ts:new Date().toISOString(), where, msg:String(m).slice(0,600), stack: (err?.stack||"").slice(0,1200)}; lastErrors.unshift(e as any); if(lastErrors.length>25) lastErrors.pop(); console.error(`[${where}]`,err);}catch{} }

async function clearLock(keys:string[]){ if(!keys.length) return; await ensureTable(); const p=getPool(); const ph=keys.map(()=>"?" ).join(","); await p.query(`DELETE FROM lockouts WHERE lock_key IN (${ph})`,keys).catch((e:any)=>pushError('clearLock',e)); }

async function insertAttemptLog(d:{ip:string,angle:number,status:'success'|'fail'|'locked'|'vpn',browser?:string,fingerprint?:string,deviceId?:string,os?:string}): Promise<number|null>{
  try{
    await ensureTable(); const p=getPool();
    const cleanIp=normalizeIp(d.ip); const subnet=getSubnet(cleanIp);
    const minimalLoc=JSON.stringify({ip:cleanIp,subnet,browser:(d.browser||"").slice(0,120),os:(d.os||"").slice(0,80),status:d.status,ts:Date.now()});
    const [res]=await p.query<any>(`INSERT INTO attempt_logs (ip,subnet,angle,status,browser,fingerprint,device_id,os,localization) VALUES (?,?,?,?,?,?,?,?,?)`,[cleanIp,subnet,d.angle,d.status,(d.browser||"").slice(0,500)||null,d.fingerprint||null,d.deviceId||null,(d.os||"").slice(0,100)||null,minimalLoc]);
    const id=(res as any)?.insertId; return id||null;
  }catch(e:any){ pushError('insertAttemptLog',e); return null; }
}
async function backfillGeo(id:number, cleanIp:string, req:any, browser?:string, os?:string){
  try{
    if(!id) return; const p=getPool();
    const geo=await fetchGeoFast(cleanIp, req);
    if(!geo) return;
    const full={...geo, ip:cleanIp, subnet:getSubnet(cleanIp), browser:(browser||"").slice(0,120), os:(os||"").slice(0,80)};
    await p.query(`UPDATE attempt_logs SET localization=? WHERE id=?`,[JSON.stringify(full),id]);
  }catch(e:any){ pushError('backfillGeo',e); }
}
async function logAttempt(d:{ip:string,angle:number,status:'success'|'fail'|'locked'|'vpn',browser?:string,fingerprint?:string,deviceId?:string,req?:any,os?:string}){ try{ await ensureTable(); const p=getPool(); const cleanIp=normalizeIp(d.ip); const subnet=getSubnet(cleanIp); const minimalLoc=JSON.stringify({ip:cleanIp,subnet,browser:d.browser?.slice(0,120)||""}); const [res]=await p.query<any>(`INSERT INTO attempt_logs (ip,subnet,angle,status,browser,fingerprint,device_id,localization) VALUES (?,?,?,?,?,?,?,?)`,[cleanIp,subnet,d.angle,d.status,d.browser?.slice(0,500)||null,d.fingerprint||null,d.deviceId||null,minimalLoc]) as any; const id=res?.insertId; if(id){ fetchGeoFast(cleanIp,d.req).then(async geo=>{ if(!geo) return; const full={...geo,ip:cleanIp,subnet,browser:d.browser?.slice(0,120)}; await p.query(`UPDATE attempt_logs SET localization=? WHERE id=?`,[JSON.stringify(full),id]).catch(()=>{}); }).catch(()=>{}); } }catch(e){ console.error("logAttempt",e); } }
async function checkVpnAndUpdate(fp:string,ip:string){ if(!fp||fp==="fp-fallback") return {isVpn:false}; try{ await ensureTable(); const p=getPool(); const subnet=getSubnet(ip); const [rows]=await p.query<any[]>(`SELECT first_subnet,last_ip,last_subnet FROM device_networks WHERE fingerprint=?`,[fp]); const ex=(rows as any[])[0]; if(!ex){ await p.query(`INSERT INTO device_networks (fingerprint,first_ip,first_subnet,last_ip,last_subnet) VALUES (?,?,?,?,?)`,[fp,ip,subnet,ip,subnet]); return {isVpn:false}; } const changed=ex.last_ip!==ip||ex.last_subnet!==subnet; await p.query(`UPDATE device_networks SET last_ip=?,last_subnet=? WHERE fingerprint=?`,[ip,subnet,fp]); return {isVpn:changed && ex.first_subnet!==subnet}; }catch{ return {isVpn:false}; } }
async function getLockedFromDB(){ await ensureTable(); const [rows]=await getPool().query<any[]>(`SELECT * FROM lockouts WHERE locked_until > NOW()`); return (rows as any[]).map(r=>({...r, lock_key:r.lock_key, ip:r.lock_key, fingerprint:r.lock_key })); }

export const angleRouter = router({
  status: publicProcedure.input(z.object({fingerprint:z.string().optional(),deviceId:z.string().optional()})).query(async({ctx,input})=>{ const ip=getClientIp(ctx.req); const {deviceId,cookieId}=ensureDoubleCookie(ctx,input.deviceId); const fp=input.fingerprint||""; const sk=getSubnetKey(ip); const pk=fp||deviceId||cookieId||ip; const keys=[...new Set([pk,ip,sk,deviceId,cookieId,fp].filter(Boolean))] as string[]; const rem=await getRemainingMax(keys); if(rem>0) return {isLocked:true,locked:true,remainingAttempts:0,attemptsLeft:0,remainingLockoutMs:rem,remainingMs:rem}; const rec=await getRecord(pk); const left=rec?Math.max(0,MAX_ATTEMPTS-rec.failed_attempts):MAX_ATTEMPTS; return {isLocked:false,locked:false,remainingAttempts:left,attemptsLeft:left,remainingLockoutMs:0,remainingMs:0,maxAttempts:MAX_ATTEMPTS}; }),
  getStatus: publicProcedure.input(z.object({fingerprint:z.string().optional(),deviceId:z.string().optional()})).query(async({ctx,input})=>{ const ip=getClientIp(ctx.req); const {deviceId,cookieId}=ensureDoubleCookie(ctx,input.deviceId); const fp=input.fingerprint||""; const sk=getSubnetKey(ip); const pk=fp||deviceId||cookieId||ip; const keys=[...new Set([pk,ip,sk,deviceId,cookieId,fp].filter(Boolean))] as string[]; const rem=await getRemainingMax(keys); if(rem>0) return {isLocked:true,locked:true,remainingAttempts:0,attemptsLeft:0,remainingLockoutMs:rem,remainingMs:rem}; const rec=await getRecord(pk); const left=rec?Math.max(0,MAX_ATTEMPTS-rec.failed_attempts):MAX_ATTEMPTS; return {isLocked:false,locked:false,remainingAttempts:left,attemptsLeft:left,remainingLockoutMs:0,remainingMs:0,maxAttempts:MAX_ATTEMPTS}; }),
  verify: publicProcedure.input(z.object({angle:z.number(),fingerprint:z.string().optional(),deviceId:z.string().optional(),browser:z.string().optional(),os:z.string().optional()})).mutation(async({ctx,input})=>{ (ctx as any).user={id:1,openId:"public-user",name:"Gość",email:"guest@example.com",loginMethod:"public",role:"user",createdAt:new Date(),updatedAt:new Date(),lastSignedIn:new Date()} as any; const t0=Date.now(); const ip=getClientIp(ctx.req); const {deviceId,cookieId}=ensureDoubleCookie(ctx,input.deviceId); const fp=input.fingerprint||""; const effectiveOs = (input.os && String(input.os).trim()) ? String(input.os).trim().slice(0,80) : (detectOs(ctx.req, input.browser) || parseOsFromUA(String(input.browser||"")) || "Windows"); const sk=getSubnetKey(ip); const pk=fp||deviceId||cookieId||ip; const keys=[...new Set([pk,ip,sk,deviceId,cookieId,fp].filter(Boolean))] as string[]; const rem=await getRemainingMax(keys); if(rem>0){ return {success:false,reason:"locked" as const,remainingLockoutMs:rem}; } const ok=Math.abs(input.angle-CORRECT_ANGLE)<=TOLERANCE; const vpnP=checkVpnAndUpdate(fp,ip); if(ok){ await clearLock(keys); const lid=await insertAttemptLog({ip,angle:input.angle,status:'success',browser:input.browser,fingerprint:fp,deviceId,os:effectiveOs}); if(lid) backfillGeo(lid,ip,ctx.req,input.browser,effectiveOs).catch(()=>{}); return {success:true,reason:"correct" as const, _ms:Date.now()-t0}; } else { const [vpnRes,incRes]=await Promise.all([vpnP, incrementFail(keys,fp,ip)]); const lid2=await insertAttemptLog({ip,angle:input.angle,status:incRes.locked?'locked':vpnRes.isVpn?'vpn':'fail',browser:input.browser,fingerprint:fp,deviceId,os:effectiveOs}); if(lid2) backfillGeo(lid2,ip,ctx.req,input.browser,effectiveOs).catch(()=>{}); if(incRes.locked) return {success:false,reason:"locked" as const,remainingLockoutMs:incRes.duration,remainingAttempts:0,isRepeat:incRes.duration===REPEAT_LOCKOUT_MS, _ms:Date.now()-t0}; const rec=await getRecord(pk); const left=rec?Math.max(0,MAX_ATTEMPTS-rec.failed_attempts):MAX_ATTEMPTS-1; return {success:false,reason:vpnRes.isVpn?"vpn_detected" as const:"invalid_angle" as const,remainingAttempts:left, _ms:Date.now()-t0}; } }),
});


async function unblockCompletely(opts:{ip?:string,fingerprint?:string,deviceId?:string,key?:string}){
  try{
    await ensureTable(); const p=getPool();
    const toDelete=new Set<string>();
    const likes=new Set<string>();
    const addLike=(v:string)=>{ if(v && v.length>=3) likes.add(v); };
    const norm = (v:string)=>normalizeIp(v);

    if(opts.key){
      const k=String(opts.key).trim();
      if(!k) return {ok:true};
      toDelete.add(k);
      addLike(k);
      if(isIPv4(norm(k))){
        const clean=norm(k);
        const sub=getSubnet(clean);
        const subKey=getSubnetKey(clean);
        toDelete.add(clean); toDelete.add(sub); toDelete.add(subKey);
        addLike(clean); addLike(sub); addLike(subKey);
      } else if(k.startsWith("subnet:")){
        const sub=k.replace("subnet:","").trim();
        addLike(sub); addLike(k);
        // also add all ips that start with this subnet
        // will be handled by LIKE %sub%
      } else {
        // fingerprint / deviceId case - also try to find its last ip from device_networks
        if(k.length>8) addLike(k.slice(0,12));
      }
    }
    if(opts.ip){
      const clean=norm(opts.ip);
      const sub=getSubnet(clean);
      const subKey=getSubnetKey(clean);
      toDelete.add(clean); toDelete.add(sub); toDelete.add(subKey);
      addLike(clean); addLike(sub); addLike(subKey);
    }
    if(opts.fingerprint){
      const fp=String(opts.fingerprint).trim();
      if(fp){ toDelete.add(fp); addLike(fp);
        try{
          const [rows]=await p.query<any[]>(`SELECT last_ip, last_subnet, first_subnet FROM device_networks WHERE fingerprint=?`,[fp]);
          const r=(rows as any[])[0];
          if(r?.last_ip){ const c=norm(r.last_ip); toDelete.add(c); addLike(c); addLike(getSubnet(c)); addLike(getSubnetKey(c)); }
          if(r?.last_subnet){ addLike(r.last_subnet); addLike(`subnet:${r.last_subnet}`); toDelete.add(`subnet:${r.last_subnet}`); }
          if(r?.first_subnet){ addLike(r.first_subnet); }
        }catch{}
      }
    }
    if(opts.deviceId){
      const did=String(opts.deviceId).trim();
      if(did){ toDelete.add(did); addLike(did); }
    }

    // 1. exact IN delete
    if(toDelete.size){
      const arr=[...toDelete].filter(Boolean);
      const ph=arr.map(()=>'?').join(',');
      await p.query(`DELETE FROM lockouts WHERE lock_key IN (${ph})`,arr).catch((e:any)=>pushError('unblockCompletely IN',e));
    }
    // 2. LIKE deletes for subnet/ip fragments
    for(const pat of [...likes]){
      if(!pat || pat.length<3) continue;
      // avoid super generic like 'desktop'
      if(pat==='desktop' || pat==='Chrome') continue;
      await p.query(`DELETE FROM lockouts WHERE lock_key LIKE ?`,[`%${pat}%`]).catch(()=>{});
    }
    // 3. also clean device_networks for fingerprint
    if(opts.fingerprint){
      await p.query(`DELETE FROM device_networks WHERE fingerprint=?`,[opts.fingerprint]).catch(()=>{});
    }
    // 4. if ip provided, also clean any device_networks that have that ip as last_ip
    if(opts.ip){
      try{ const clean=norm(opts.ip); await p.query(`DELETE FROM device_networks WHERE last_ip=? OR first_ip=?`,[clean,clean]).catch(()=>{}); }catch{}
    }
    return {ok:true, cleared:[...toDelete], likes:[...likes]};
  }catch(e:any){ pushError('unblockCompletely',e); return {ok:false, error:String(e?.message||e)}; }
}

export const adminRouter = router({
  verifyPin: publicProcedure.input(z.object({pin:z.string()})).mutation(async({input})=>{ if(input.pin===ADMIN_PIN) return {ok:true,success:true}; throw new Error("Nieprawidłowy PIN"); }),
  list: publicProcedure.query(async()=>{ return await getLockedFromDB(); }),
  getBlocked: publicProcedure.query(async()=>{ return await getLockedFromDB(); }),
  getBlockedDevices: publicProcedure.query(async()=>{ return await getLockedFromDB(); }),
  getAllBlocked: publicProcedure.query(async()=>{ return await getLockedFromDB(); }),
  getLockedIPs: publicProcedure.query(async()=>{ const d=await getLockedFromDB(); return d.map(x=>x.lock_key); }),
  getLockedDevices: publicProcedure.query(async()=>{ return await getLockedFromDB(); }),
  history: publicProcedure.query(async()=>{ try{ await ensureTable(); const [rows]=await getPool().query<any[]>(`SELECT id, ip, COALESCE(NULLIF(ip,''),fingerprint,device_id,'0.0.0.0') as display_ip, angle, status, COALESCE(NULLIF(browser,''),device_id,fingerprint,'-') as device, browser, fingerprint, device_id, os, localization, created_at, DATE_FORMAT(created_at,'%Y-%m-%d %H:%i:%s') as time, DATE_FORMAT(created_at,'%Y-%m-%d %H:%i:%s') as Czas FROM attempt_logs ORDER BY created_at DESC LIMIT 10000`); return (rows as any[]).map(r=>{ let loc:any={}; try{ loc=r.localization?JSON.parse(r.localization):{}; }catch{}; const ip=r.ip||loc.query||loc.ip||r.display_ip; return {...r, ip, display_ip:ip, localization:r.localization, country:loc.country||"", city:loc.city||"", zip:loc.zip||"", timezone:loc.timezone||"", isp:loc.isp||loc.org||"", org:loc.org||"", as:loc.as||"", lat:loc.lat??null, lon:loc.lon??null, coords:(loc.lat!=null && loc.lon!=null)?`${loc.lat},${loc.lon}`:"", region:loc.regionName||loc.region||"", query:loc.query||ip, browser: r.browser||loc.browser||"", os:r.os||loc.os||"", osFamily:r.os||loc.os||""}; }); }catch(e){ console.error(e); return [] as any; } }),
  getLogs: publicProcedure.query(async()=>{ try{ await ensureTable(); const [rows]=await getPool().query(`SELECT id, ip, angle, status, browser as device, fingerprint, localization, created_at, DATE_FORMAT(created_at,'%Y-%m-%d %H:%i:%s') as time FROM attempt_logs ORDER BY created_at DESC LIMIT 10000`); return rows as any; }catch{ return [] as any; } }),
  getHistory: publicProcedure.query(async()=>{ try{ await ensureTable(); const [rows]=await getPool().query(`SELECT id, ip, angle, status, browser as device, fingerprint, localization, created_at FROM attempt_logs ORDER BY created_at DESC LIMIT 10000`); return rows as any; }catch{ return [] as any; } }),
  getAttempts: publicProcedure.input(z.object({limit:z.number().optional(),offset:z.number().optional()}).optional()).query(async({input})=>{ try{ await ensureTable(); const lim=input?.limit||100; const off=input?.offset||0; const [rows]=await getPool().query<any[]>(`SELECT id, ip, angle, status, browser, fingerprint, device_id, localization, created_at FROM attempt_logs ORDER BY created_at DESC LIMIT ? OFFSET ?`,[lim,off]); return (rows as any[]).map(r=>{ let loc:any={}; try{ loc=r.localization?JSON.parse(r.localization):{}; }catch{} const ip=r.ip||loc.query||loc.ip||""; const country=loc.country||""; return { id:r.id, ip, ipAddress:ip, angle:r.angle, status:r.status, isCorrect:r.status==='success'?1:0, browser:r.browser||loc.browser||"", browserFamily:r.browser||loc.browser||"", fingerprint:r.fingerprint||"", deviceId:r.device_id||r.fingerprint||"", device_id:r.device_id||"", country, countryCode:country, city:loc.city||"", zip:loc.zip||"", timezone:loc.timezone||"", isp:loc.isp||loc.org||"", org:loc.org||"", as:loc.as||"", latitude:loc.lat??null, longitude:loc.lon??null, lat:loc.lat??null, lon:loc.lon??null, coords:(loc.lat!=null&&loc.lon!=null)?`${loc.lat},${loc.lon}`:"", region:loc.regionName||loc.region||"", query:loc.query||ip, localization:r.localization, created_at:r.created_at, createdAt:r.created_at, osFamily:"", deviceType:"desktop" }; }); }catch(e){ console.error(e); return [] as any; } }),
  getStats: publicProcedure.query(async()=>{ try{ await ensureTable(); const [a]=await getPool().query<any[]>(`SELECT COUNT(*) as total, SUM(status='success') as ok FROM attempt_logs`); const total=(a as any[])[0]?.total||0; const ok=(a as any[])[0]?.ok||0; const locked=(await getLockedFromDB()).length; return {totalAttempts:total, successfulAttempts:ok, failedAttempts:total-ok, currentlyLockedIps:locked, lockedIPs:locked, successRate: total?Math.round((ok/total)*100):0}; }catch{ return {totalAttempts:0,successfulAttempts:0,failedAttempts:0,currentlyLockedIps:0,successRate:0}; } }),
  getAdvancedAnalytics: publicProcedure.query(async()=>{ return {totalAttempts:0, geographicDistribution:[], deviceDistribution:[], repeatOffenders:[]}; }),
  unlockIp: publicProcedure.input(z.object({ipAddress:z.string().optional(),fingerprint:z.string().optional(),deviceId:z.string().optional(),key:z.string().optional()}).or(z.string())).mutation(async({input})=>{ const o=typeof input==='string'?{key:input}:input as any; return await unblockCompletely({ip:o.ipAddress||o.ip, fingerprint:o.fingerprint, deviceId:o.deviceId, key:o.key||o.ipAddress||o.fingerprint||o.deviceId}); }),
  unblock: publicProcedure.input(z.object({key:z.string().optional(),ip:z.string().optional(),fingerprint:z.string().optional(),deviceId:z.string().optional()}).or(z.string())).mutation(async({input})=>{ const o=typeof input==='string'?{key:input}:input as any; return await unblockCompletely({ip:o.ip, fingerprint:o.fingerprint, deviceId:o.deviceId, key:o.key||o.ip||o.fingerprint}); }),
  adminUnblock: publicProcedure.input(z.object({key:z.string()})).mutation(async({input})=>{ return await unblockCompletely({key:input.key}); }),
  forceUnblockMe: publicProcedure.input(z.object({fingerprint:z.string().optional(),deviceId:z.string().optional()})).mutation(async({ctx,input})=>{ const ip=getClientIp(ctx.req); const {deviceId:did,cookieId}=ensureDoubleCookie(ctx,input.deviceId); const fp=input.fingerprint||""; return await unblockCompletely({ip, fingerprint:fp, deviceId:did||cookieId, key:fp||did||cookieId||ip}); }),
  clearAll: publicProcedure.mutation(async()=>{ await ensureTable(); const p=getPool(); await p.query(`DELETE FROM lockouts`); await p.query(`DELETE FROM device_networks`); await p.query(`DELETE FROM attempt_logs`); return {ok:true}; }),
  clearLogs: publicProcedure.mutation(async()=>{ await ensureTable(); await getPool().query(`DELETE FROM attempt_logs`); return {ok:true}; }),
  clearHistory: publicProcedure.mutation(async()=>{ await ensureTable(); await getPool().query(`DELETE FROM attempt_logs`); return {ok:true}; }),
  adminClearAll: publicProcedure.mutation(async()=>{ await ensureTable(); const p=getPool(); await p.query(`DELETE FROM lockouts`); await p.query(`DELETE FROM attempt_logs`); return {ok:true}; }),
  exportData: publicProcedure.query(async()=>{ const [rows]=await getPool().query(`SELECT * FROM attempt_logs ORDER BY created_at DESC LIMIT 10000`); return rows as any; }),
  getLastErrors: publicProcedure.query(async()=>{ return lastErrors; }),
  clearErrors: publicProcedure.mutation(async()=>{ lastErrors.length=0; return {ok:true}; }),
  getMyIp: publicProcedure.query(async({ctx})=>{ const ip=getClientIp(ctx.req); const geo=await fetchGeoFast(ip,ctx.req); return {ip,subnet:getSubnet(ip),geo,headers:{'x-forwarded-for':ctx.req.headers?.['x-forwarded-for'],'cf-connecting-ip':ctx.req.headers?.['cf-connecting-ip']}}; }),
  getUserProfile: publicProcedure.input(z.object({ipAddress:z.string().optional(),fingerprint:z.string().optional(),deviceId:z.string().optional()}).optional()).query(async()=>{ return null; }),
});

export const appRouter = router({ angle: angleRouter, admin: adminRouter, status: angleRouter.status, getStatus: angleRouter.getStatus, verify: angleRouter.verify, });
export type AppRouter = typeof appRouter;

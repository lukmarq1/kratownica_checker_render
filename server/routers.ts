import { COOKIE_NAME } from "@shared/const";
import { getSessionCookieOptions } from "./_core/cookies";
import { ENV } from "./_core/env";
import { systemRouter } from "./_core/systemRouter";
import { publicProcedure, router } from "./_core/trpc";
import { z } from "zod";
import { parseUserAgent } from "./userAgentParser";
import crypto from "crypto";

// ULTIMATE: WiFi + 24h pamięć VPN<->WiFi + INSTANT VPN BAN
const MAX_ATTEMPTS = 2;
const MAX_SUBNET_ATTEMPTS = 3;
const MAX_GEO_ATTEMPTS = 4;
const LOCKOUT_MS = 24 * 60 * 60 * 1000;
const VPN_DETECTION_WINDOW_MS = 60 * 60 * 1000;
const RECENT_LINK_WINDOW_MS = 24 * 60 * 60 * 1000;

interface AttemptRecord {
  failedAttempts: number; lockedUntil: Date | null; firstSeen: Date; lastSeen: Date;
  totalAttempts: number; successfulAttempts: number; ips: Set<string>; fingerprints: Set<string>; isRepeatedOffender: boolean;
}
interface HistoryEntry {
  id: string; ipAddress: string; fingerprint: string; deviceId: string; angle: number; isCorrect: number;
  country: string; city: string; zip: string; timezone: string; isp: string; org: string; as: string;
  latitude: string; longitude: string; browserFamily: string; osFamily: string; deviceType: string;
  createdAt: Date; timestamp: Date; userAgent: string; isVpn: boolean;
}

const attemptStore = new Map<string, AttemptRecord>();
const historyStore: HistoryEntry[] = [];
const geoCache = new Map<string, any>();

function getSubnet(ip: string): string | null {
  if (!ip || ip.includes(":") || ip.startsWith("fallback") || ip === "unknown") return null;
  const p = ip.split("."); if (p.length!== 4) return null;
  return `${p[0]}.${p[1]}.${p[2]}.0/24`;
}
function getGeoKey(geo: any): string | null {
  if (!geo) return null;
  const city = (geo.city || "unknown").trim(); const isp = (geo.isp || geo.org || "unknown").trim();
  if (!city || city === "Unknown") return null; return `geo:${city}-${isp}`.slice(0,80);
}
function getGeoKeyFromHistory(h: HistoryEntry): string | null {
  if (!h.city || h.city === "Unknown") return null; return `geo:${h.city}-${h.isp || h.org || "unknown"}`.slice(0,80);
}
function getMaxForKey(key: string): number {
  if (key.startsWith("geo:")) return MAX_GEO_ATTEMPTS; if (key.includes("/24")) return MAX_SUBNET_ATTEMPTS; return MAX_ATTEMPTS;
}
function getOrCreateRecord(key: string) {
  let rec = attemptStore.get(key);
  if (!rec) { rec = { failedAttempts: 0, lockedUntil: null, firstSeen: new Date(), lastSeen: new Date(), totalAttempts: 0, successfulAttempts: 0, ips: new Set(), fingerprints: new Set(), isRepeatedOffender: false }; attemptStore.set(key, rec); }
  if (rec.lockedUntil && rec.lockedUntil.getTime() < Date.now()) { rec.failedAttempts = 0; rec.lockedUntil = null; }
  rec.lastSeen = new Date(); return rec;
}
async function isLocked(key: string) { const rec = attemptStore.get(key); if (!rec?.lockedUntil) return false; if (rec.lockedUntil.getTime() < Date.now()) { rec.failedAttempts = 0; rec.lockedUntil = null; return false; } return true; }
async function getRemainingLockoutTime(key: string) { const rec = attemptStore.get(key); if (!rec?.lockedUntil) return 0; return Math.max(0, rec.lockedUntil.getTime() - Date.now()); }
async function recordFailedAttempt(key: string, ip: string, fingerprint?: string) {
  const rec = getOrCreateRecord(key); const max = getMaxForKey(key); rec.failedAttempts += 1; rec.totalAttempts += 1; rec.ips.add(ip); if (fingerprint) rec.fingerprints.add(fingerprint); if (rec.ips.size > 1) rec.isRepeatedOffender = true;
  let isLockedNow = false; let lockedUntil: Date | null = null; if (rec.failedAttempts >= max) { isLockedNow = true; lockedUntil = new Date(Date.now() + LOCKOUT_MS); rec.lockedUntil = lockedUntil; }
  return { remainingAttempts: Math.max(0, max - rec.failedAttempts), isLocked: isLockedNow, lockedUntil, max };
}
async function resetAttempts(keys: string[], ip: string, fingerprint?: string) { for (const k of keys) { if (k.startsWith("geo:")) continue; const rec = getOrCreateRecord(k); rec.failedAttempts = 0; rec.lockedUntil = null; rec.successfulAttempts += 1; rec.totalAttempts += 1; rec.ips.add(ip); if (fingerprint) rec.fingerprints.add(fingerprint); } }
async function fetchGeo(ip: string) {
  if (ip.startsWith("fallback") || ip === "unknown" || ip.startsWith("192.168") || ip.startsWith("127.") || ip.startsWith("10.")) return null; if (geoCache.has(ip)) return geoCache.get(ip);
  try { const c = new AbortController(); const t = setTimeout(()=>c.abort(),2000); const res = await fetch(`https://ipwho.is/${ip}`, { signal: c.signal } as any); clearTimeout(t); if (!res.ok) return null; const d = await res.json(); if (!d.success) return null; const g = { country: d.country||"Unknown", city: d.city||"Unknown", zip: d.postal||"", timezone: d.timezone?.id||"", isp: d.connection?.isp||"", org: d.connection?.org||"", as: d.connection?.asn?`AS${d.connection.asn} ${d.connection?.org||""}`:"", latitude: String(d.latitude||""), longitude: String(d.longitude||""), isHosting: d.connection?.hosting||false, isProxy: d.security?.is_proxy||d.security?.is_vpn||d.security?.is_tor||false, isVpnFlag: d.security?.is_vpn||false }; geoCache.set(ip,g); return g; } catch { return null; }
}
function detectVpnUsage(fp: string, curIp: string, curGeo: any): boolean { if (!fp) return!!(curGeo?.isHosting||curGeo?.isProxy); const recent = historyStore.filter(h=>h.fingerprint===fp && Date.now()-h.createdAt.getTime()<VPN_DETECTION_WINDOW_MS); if (recent.length===0) return!!(curGeo?.isHosting||curGeo?.isProxy); const diffIp = recent.some(h=>h.ipAddress!==curIp); const diffCountry = curGeo && recent.some(h=>h.country!==curGeo.country); return!!(diffIp||diffCountry||curGeo?.isHosting||curGeo?.isProxy); }
function getRecentLinkedKeys(fingerprint: string, deviceId: string): string[] { const now = Date.now(); const keys = new Set<string>(); for (const h of historyStore) { const sameDevice = (fingerprint && h.fingerprint===fingerprint) || (deviceId && h.deviceId===deviceId); if (!sameDevice) continue; if (now - h.createdAt.getTime() > RECENT_LINK_WINDOW_MS) continue; if (h.ipAddress) { keys.add(h.ipAddress); const s=getSubnet(h.ipAddress); if(s) keys.add(s); } const gk=getGeoKeyFromHistory(h); if(gk) keys.add(gk); } return Array.from(keys); }
async function addHistory(ip:string, fp:string, devId:string, angle:number, correct:boolean, ua:string, parsed:any, geo:any, isVpn:boolean){ const now=new Date(); const e:HistoryEntry={ id:`${Date.now()}-${Math.random().toString(36).slice(2)}`, ipAddress:ip, fingerprint:fp||"unknown", deviceId:devId||"unknown", angle, isCorrect:correct?1:0, country:geo?.country||"Unknown", city:geo?.city||"Unknown", zip:geo?.zip||"", timezone:geo?.timezone||"", isp:geo?.isp||"", org:geo?.org||"", as:geo?.as||"", latitude:geo?.latitude||"", longitude:geo?.longitude||"", browserFamily:parsed?.browserFamily||parsed?.browser||"Unknown", osFamily:parsed?.osFamily||parsed?.os||"Unknown", deviceType:parsed?.deviceType||parsed?.device||"desktop", createdAt:now, timestamp:now, userAgent:ua, isVpn }; historyStore.unshift(e); if(historyStore.length>1000) historyStore.pop(); }
function getClientIp(req:any):string{ const xff=req.headers["x-forwarded-for"]; let ip="unknown"; if(xff){ const ips=Array.isArray(xff)?xff:xff.split(","); const first=(ips[0]||"").trim(); if(first&&first!=="unknown") ip=first; } if(ip==="unknown"&&req.ip&&req.ip!=="unknown") ip=req.ip; if(ip==="unknown"){ const ua=req.headers["user-agent"]||""; ip=`fallback-${Buffer.from(ua).toString("base64").slice(0,8)}`; } return ip; }
function getDeviceId(req:any):string{ const c=req.headers.cookie||""; const m=c.match(/device_id=([^;]+)/); return m?m[1]:""; }
async function handleGetStatus(ctx:any, input:any){ const ip=getClientIp(ctx.req); let deviceId=input.deviceId||getDeviceId(ctx.req); const fingerprint=input.fingerprint||""; const subnet=getSubnet(ip); const geo=await fetchGeo(ip); const geoKey=getGeoKey(geo); const baseKeys=[fingerprint, deviceId, ip, subnet, geoKey].filter(Boolean) as string[]; const linkedKeys=getRecentLinkedKeys(fingerprint, deviceId); const keysToCheck=Array.from(new Set([...baseKeys,...linkedKeys])); for(const k of keysToCheck){ if(await isLocked(k)){ return { isLocked:true, locked:true, remainingLockoutMs:await getRemainingLockoutTime(k), remainingMs:await getRemainingLockoutTime(k), blockedBy:k, remainingAttempts:0, attemptsLeft:0, maxAttempts:MAX_ATTEMPTS }; } } const primary=fingerprint||deviceId||ip; const rec=primary?attemptStore.get(primary):undefined; const failed=rec?.failedAttempts||0; const left=Math.max(0, MAX_ATTEMPTS - failed); return { isLocked:false, locked:false, failedAttempts:failed, remainingAttempts:left, attemptsLeft:left, remainingLockoutMs:0, remainingMs:0, maxAttempts:MAX_ATTEMPTS }; }

export const appRouter = router({
  system: systemRouter,
  auth: router({
    me: publicProcedure.query(async ({ctx})=> (ctx as any).user||null),
    logout: publicProcedure.mutation(async ({ctx})=>{ const o=getSessionCookieOptions((ctx.req as any)); if((ctx.res as any).clearCookie) (ctx.res as any).clearCookie(COOKIE_NAME,{...o,maxAge:-1}); return {success:true} as const; }),
  }),
  angle: router({
    getStatus: publicProcedure.input(z.object({fingerprint:z.string().optional(),deviceId:z.string().optional()})).query(async ({ctx,input})=> handleGetStatus(ctx,input)),
    status: publicProcedure.input(z.object({fingerprint:z.string().optional(),deviceId:z.string().optional()})).query(async ({ctx,input})=> handleGetStatus(ctx,input)),
    verify: publicProcedure.input(z.object({angle:z.number(),fingerprint:z.string().optional(),deviceId:z.string().optional(),browser:z.string().optional(),os:z.string().optional()})).mutation(async ({ctx,input})=>{
      (ctx as any).user={id:1,openId:"public-user",name:"Gość",email:"guest@example.com",loginMethod:"public",role:"user",createdAt:new Date(),updatedAt:new Date(),lastSignedIn:new Date()} as any;
      const ip=getClientIp(ctx.req); let deviceId=getDeviceId(ctx.req); if(!deviceId){ deviceId=crypto.randomUUID(); if((ctx.res as any).cookie) (ctx.res as any).cookie('device_id',deviceId,{maxAge:365*24*60*60*1000,httpOnly:true,sameSite:'lax',path:'/'}); }
      const fingerprint=input.fingerprint||""; const subnet=getSubnet(ip); const ua=ctx.req.headers["user-agent"]||"unknown"; const parsed=parseUserAgent(ua); if(input.browser) parsed.browserFamily=input.browser as any;
      const geo=await fetchGeo(ip); const geoKey=getGeoKey(geo);
      // INSTANT BAN DLA VPN
      const isInstantVpnBan =!!(geo?.isHosting || geo?.isProxy || geo?.isVpnFlag);
      if (isInstantVpnBan) {
        const banKeys = [fingerprint, deviceId, ip, subnet, geoKey].filter(Boolean) as string[]; const linkedKeys = getRecentLinkedKeys(fingerprint, deviceId); const allBanKeys = Array.from(new Set([...banKeys,...linkedKeys]));
        for (const k of allBanKeys) { const rec = getOrCreateRecord(k); rec.failedAttempts = getMaxForKey(k); rec.lockedUntil = new Date(Date.now() + LOCKOUT_MS); rec.ips.add(ip); if (fingerprint) rec.fingerprints.add(fingerprint); }
        await addHistory(ip,fingerprint,deviceId,input.angle,false,ua,parsed,geo,true);
        return { success: false, reason: "vpn_detected", isVpn: true, isLocked: true, locked: true, remainingAttempts: 0, remaining: 0, remainingLockoutMs: LOCKOUT_MS, blockedBy: ip, message: `VPN/Proxy wykryty (${geo?.isp||geo?.org}) - blokada 24h` };
      }
      const baseKeys=[fingerprint,deviceId,ip,subnet,geoKey].filter(Boolean) as string[]; const linkedKeys=getRecentLinkedKeys(fingerprint, deviceId); const keysToCheck=Array.from(new Set([...baseKeys,...linkedKeys]));
      for(const k of keysToCheck){ if(await isLocked(k)){ return {success:false,reason:"locked",remainingLockoutMs:await getRemainingLockoutTime(k),blockedBy:k}; } }
      const correctAngle=65; const tol=0.5; const isCorrect=input.angle>=correctAngle-tol && input.angle<=correctAngle+tol; const isVpn=detectVpnUsage(fingerprint,ip,geo);
      await addHistory(ip,fingerprint,deviceId,input.angle,isCorrect,ua,parsed,geo,isVpn);
      if(isCorrect){ await resetAttempts(keysToCheck,ip,fingerprint); return {success:true,reason:"correct",angle:input.angle}; }
      else{ const all: Array<{key:string,r:any}> = []; for(const k of keysToCheck){ const r=await recordFailedAttempt(k,ip,fingerprint); all.push({key:k,r}); } const locked=all.filter(x=>x.r.isLocked); if(locked.length>0){ const first=locked[0]; return {success:false,reason:"locked",remainingAttempts:0,remaining:0,isLocked:true,locked:true,lockedUntil:first.r.lockedUntil,remainingLockoutMs:first.r.lockedUntil?first.r.lockedUntil.getTime()-Date.now():LOCKOUT_MS,isVpn,blockedBy:first.key,allBlockedBy:locked.map(x=>x.key)}; } const min=Math.min(...all.map(x=>x.r.remainingAttempts)); return {success:false,reason:isVpn?"vpn_detected":"incorrect",remainingAttempts:min,remaining:min,isLocked:false,locked:false,isVpn,blockedBy:undefined}; }
    }),
  }),
  admin: router({
    getAttempts: publicProcedure.input(z.object({limit:z.number().default(100),offset:z.number().default(0)})).query(async ({input})=> historyStore.slice(input.offset,input.offset+input.limit)),
    getStats: publicProcedure.query(async ()=>{ const total=historyStore.length; const ok=historyStore.filter(h=>h.isCorrect===1).length; const fail=total-ok; const uniq=attemptStore.size; const locked=Array.from(attemptStore.values()).filter(r=>r.lockedUntil&&r.lockedUntil.getTime()>Date.now()).length; const vpn=historyStore.filter(h=>h.isVpn).length; return {totalAttempts:total,uniqueIps:uniq,uniqueIPs:uniq,successfulAttempts:ok,failedAttempts:fail,currentlyLockedIps:locked,lockedIPs:locked,successRate:total?Math.round((ok/total)*100):0,repeatedOffenders:Array.from(attemptStore.values()).filter(r=>r.isRepeatedOffender).length,vpnAttempts:vpn}; }),
    getAdvancedAnalytics: publicProcedure.query(async ()=>{ const total=historyStore.length; const ok=historyStore.filter(h=>h.isCorrect===1).length; const fail=total-ok; const uniq=attemptStore.size; const byCountry:Record<string,number>={}; historyStore.forEach(h=>{byCountry[h.country]=(byCountry[h.country]||0)+1}); const geoDist=Object.entries(byCountry).map(([country,count])=>({country,count})); const byDevice:Record<string,number>={}; historyStore.forEach(h=>{byDevice[h.deviceType]=(byDevice[h.deviceType]||0)+1}); const devDist=Object.entries(byDevice).map(([deviceType,count])=>({deviceType,count})); const failedMap:Record<string,{total:number;fail:number;country:string;ips:string[];isVpn:boolean}>={}; historyStore.forEach(h=>{const k=h.fingerprint||h.deviceId||h.ipAddress; if(!failedMap[k]) failedMap[k]={total:0,fail:0,country:h.country,ips:[],isVpn:false}; failedMap[k].total++; if(h.isCorrect===0) failedMap[k].fail++; if(!failedMap[k].ips.includes(h.ipAddress)) failedMap[k].ips.push(h.ipAddress); if(h.isVpn) failedMap[k].isVpn=true;}); const repeat=Object.entries(failedMap).filter(([_,v])=>v.fail>=2||v.ips.length>1).map(([id,v],idx)=>({id:String(idx),ipAddress:v.ips.join(', '),fingerprint:id,country:v.country,totalAttempts:v.total,failedAttempts:v.fail,isVpn:v.isVpn,ips:v.ips})); return {totalAttempts:total,uniqueIps:uniq,uniqueIPs:uniq,successfulAttempts:ok,failedAttempts:fail,successRate:total?String(Math.round((ok/total)*100)):"0",repeatOffenders:repeat,geographicDistribution:geoDist,deviceDistribution:devDist,vpnAttempts:historyStore.filter(h=>h.isVpn).length}; }),
    getUserProfile: publicProcedure.input(z.object({ipAddress:z.string().optional(),fingerprint:z.string().optional(),deviceId:z.string().optional()})).query(async ({input})=>{ const key=input.fingerprint||input.deviceId||input.ipAddress; if(!key) return null; const history=historyStore.filter(h=>h.fingerprint===key||h.deviceId===key||h.ipAddress===key); if(!history.length) return null; const first=history[0]; return {country:first.country,city:first.city,isp:first.isp,deviceType:first.deviceType,org:first.org,zip:first.zip,timezone:first.timezone,as:first.as,fingerprint:first.fingerprint,deviceId:first.deviceId,ips:Array.from(new Set(history.map(h=>h.ipAddress))),isVpn:history.some(h=>h.isVpn),attempts:history.map(h=>({id:h.id,angle:h.angle,isCorrect:h.isCorrect,createdAt:h.createdAt,ip:h.ipAddress,isVpn:h.isVpn}))}; }),
    exportData: publicProcedure.query(async ()=>{ const headers=["ID","IP","Fingerprint","DeviceID","Kat","Poprawny","Data","Przegladarka","OS","Miasto","Kraj","VPN"]; const rows=historyStore.map(h=>[h.id,h.ipAddress,h.fingerprint,h.deviceId,String(h.angle),h.isCorrect?"TAK":"NIE",h.createdAt.toISOString(),h.browserFamily,h.osFamily,h.city,h.country,h.isVpn?"TAK":"NIE"]); return [headers.join(","),...rows.map(r=>r.map(v=>`"${v}"`).join(","))].join("\n"); }),
    unlockIp: publicProcedure.input(z.object({ipAddress:z.string().optional(),fingerprint:z.string().optional(),deviceId:z.string().optional(),subnet:z.string().optional(),geoKey:z.string().optional()})).mutation(async ({input})=>{ const initial=[input.fingerprint,input.deviceId,input.ipAddress,input.subnet,input.geoKey].filter(Boolean) as string[]; if(initial.length===0) return {success:false,message:"Brak ID"}; const toDel=new Set<string>(initial); if(input.ipAddress){ const s=getSubnet(input.ipAddress); if(s) toDel.add(s); } for(const h of historyStore){ const match=initial.some(k=>k===h.ipAddress||k===h.fingerprint||k===h.deviceId||k===getSubnet(h.ipAddress)||k===getGeoKeyFromHistory(h)); if(match){ if(h.ipAddress){toDel.add(h.ipAddress); const s=getSubnet(h.ipAddress); if(s) toDel.add(s);} if(h.fingerprint&&h.fingerprint!=="unknown") toDel.add(h.fingerprint); if(h.deviceId&&h.deviceId!=="unknown") toDel.add(h.deviceId); const gk=getGeoKeyFromHistory(h); if(gk) toDel.add(gk);} } for(const [sk,rec] of attemptStore.entries()){ const del=toDel.has(sk)||initial.some(k=>rec.ips.has(k)||rec.fingerprints.has(k)); if(del){ toDel.add(sk); rec.ips.forEach(ip=>toDel.add(ip)); rec.fingerprints.forEach(fp=>{if(fp!=="unknown") toDel.add(fp);}); } } for(const k of Array.from(toDel)){ const rec=attemptStore.get(k); if(rec){ rec.ips.forEach(ip=>toDel.add(ip)); rec.fingerprints.forEach(fp=>{if(fp!=="unknown") toDel.add(fp);}); } } let c=0; for(const k of toDel){ if(attemptStore.delete(k)) c++; } return {success:true,deletedKeys:Array.from(toDel),deletedCount:c}; }),
    verifyPin: publicProcedure.input(z.object({pin:z.string()})).mutation(async ({input})=>{ const p=ENV.adminPin; if(!p) return {success:false,error:"Admin PIN not configured"}; return {success:input.pin===p}; }),
    getLockedIPs: publicProcedure.query(async ()=>{ const l:string[]=[]; for(const [k,rec] of attemptStore.entries()){ if(rec.lockedUntil&&rec.lockedUntil.getTime()>Date.now()) l.push(k); } return l; }),
    getLockedAll: publicProcedure.query(async ()=>{ const l:any[]=[]; for(const [k,rec] of attemptStore.entries()){ if(rec.lockedUntil&&rec.lockedUntil.getTime()>Date.now()) l.push({key:k,type:k.startsWith("geo:")?"geo":k.includes("/24")?"subnet":rec.ips.size>0&&k.includes(".")?"ip":"device",lockedUntil:rec.lockedUntil,failedAttempts:rec.failedAttempts}); } return l; }),
  }),
});
export type AppRouter = typeof appRouter;
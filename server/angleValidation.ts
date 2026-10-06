export const CORRECT_ANGLE = 65;
export const ANGLE_TOLERANCE = 0.5;

export function isCorrectAngle(angle: number): boolean {
  return Number.isFinite(angle) && Math.abs(angle - CORRECT_ANGLE) <= ANGLE_TOLERANCE;
}

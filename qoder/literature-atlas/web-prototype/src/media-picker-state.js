// A picker owns its return gesture. Do not let that gesture close an editor underneath.
export function createMediaPickerState(now = () => performance.now()) {
  let active = false, settlingUntil = 0;
  return {
    get active() { return active; },
    begin() { if (active) return false; active = true; return true; },
    end() { active = false; settlingUntil = now() + 400; },
    blocksBack() { return active || now() < settlingUntil; },
  };
}

import type { KillSwitchState } from "../src/index.js";
import { minutesAgo } from "./time.js";

export const killSwitchDisengaged: KillSwitchState = { engaged: false };

export const killSwitchEngagedExample: KillSwitchState = {
  engaged: true,
  engaged_at: minutesAgo(3),
  reason: "Operator paused all agents pending review of the blocked invoice.",
};

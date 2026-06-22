// Remotion CLI config (build/preview only — does not affect render dimensions,
// which are defined on the <Composition> in src/Root.tsx).
import { Config } from '@remotion/cli/config';

Config.setVideoImageFormat('jpeg');
Config.setOverwriteOutput(true);
Config.setConcurrency(null); // auto = use all cores

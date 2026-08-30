/**
 * Side-effect module: installs the release console shim at import time.
 *
 * Import declarations are hoisted, so a bare `installReleaseConsole()` call in
 * index.js would run only after every other import had already been evaluated —
 * and modules log while they are being imported. Importing this module first
 * runs the shim first, because module evaluation follows import order.
 */
import {installReleaseConsole} from './index';

installReleaseConsole();

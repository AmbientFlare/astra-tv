// Must stay first: installs the release console shim before any other module is
// evaluated. Vega OS 1.2's native logging bridge blocks the JS thread, and
// modules log while they are being imported.
import './src/services/logging/install';

import { AppRegistry, LogBox } from 'react-native';
import { App } from './src/App';
import { name as appName } from './app.json';

// Temporary workaround for problem with nested text
// not working currently.
LogBox.ignoreAllLogs();

AppRegistry.registerComponent(appName, () => App);

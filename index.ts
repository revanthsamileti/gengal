import { registerRootComponent } from 'expo';

// Must be imported here, in the entry point. expo-task-manager starts a
// headless JS context to run a notification action when the app is closed, and
// that context evaluates this file — so a task defined anywhere React owns
// would not exist at the moment it is needed.
import './src/services/callActionTask';

import App from './App';

// registerRootComponent calls AppRegistry.registerComponent('main', () => App);
// It also ensures that whether you load the app in Expo Go or in a native build,
// the environment is set up appropriately
registerRootComponent(App);

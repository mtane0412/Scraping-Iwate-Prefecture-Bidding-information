import * as log4js from 'log4js';
import {executionPath} from "./config";

/*
  log出力用
*/

const logPath = `${executionPath}/logs/`;


log4js.configure({
  appenders : {
    stdout: { type: 'stdout' },
    system : {type : 'dateFile', filename : logPath + 'system/system', pattern: 'yyyy-MM-dd.log', alwaysIncludePattern: "true"},
    error : {type : 'file', filename : logPath + 'debug/error.log'},
    debug : {type : 'file', filename : logPath + 'debug/debug.log'}
  },
  categories : {
    default : {appenders : ['system', 'stdout'], level : 'info'},
    error : {appenders : ['error', 'stdout'], level: 'warn'},
    debug : {appenders : ['debug', 'stdout'], level : 'debug'}
  }
});

const systemLogger = log4js.getLogger('system');
const errorLogger = log4js.getLogger('error');
const debugLogger = log4js.getLogger('debug');

export { systemLogger, errorLogger, debugLogger }
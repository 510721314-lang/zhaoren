try {
  const tm = require('C:/Users/DC/Desktop/微信WEB开发者工具/resources/app.asar/js/utils/tokenmanager');
  console.log('keys:', Object.keys(tm));
  const m = tm.tokenManager || tm.default || tm;
  console.log('mgr keys:', Object.getOwnPropertyNames(Object.getPrototypeOf(m) || {}), Object.keys(m));
  const VT = tm.ValidType || (m.constructor && m.constructor.ValidType);
  console.log('ValidType:', JSON.stringify(VT));
  try {
    const t = m.getSessionToken ? m.getSessionToken(VT ? VT.UA_TOKEN : 'ua_token') : 'no getSessionToken';
    console.log('UA_TOKEN=' + t);
  } catch (e) { console.log('getSessionToken err:', e.stack); }
  try {
    const t2 = m.getToken ? m.getToken(VT ? VT.UA_TOKEN : 'ua_token') : 'no getToken';
    console.log('getToken=' + t2);
  } catch (e) { console.log('getToken err:', e.stack); }
} catch (e) { console.log('REQUIRE_FAIL', e.stack); }

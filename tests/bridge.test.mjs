import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildUrl, queryParamsOf, parseBody, pickVehicle, numberOrNull, toBool, trimUrl,
} from '../sdk/bridge.js';

test('buildUrl：空值剔除、空格按 %20 编码（不能是 +）', () => {
  const url = buildUrl('https://tapi.zeehoev.com/', '/v1.0/app/x', {
    vinNo: 'TESTVIN0000000001',
    keyword: 'a b',
    empty: '',
    missing: undefined,
    zero: 0,
  });
  assert.equal(url, 'https://tapi.zeehoev.com/v1.0/app/x?vinNo=TESTVIN0000000001&keyword=a%20b&zero=0');
});

test('buildUrl：路径没带前导斜杠也能拼对', () => {
  assert.equal(buildUrl('https://h', 'v1.0/a', {}), 'https://h/v1.0/a');
});

test('trimUrl：去掉尾部斜杠与空白', () => {
  assert.equal(trimUrl('  https://a.b// '), 'https://a.b');
});

test('queryParamsOf：同名多值收成数组', () => {
  const params = queryParamsOf('https://h/p?vin=1&vin=2&x=3');
  assert.deepEqual(params, { vin: ['1', '2'], x: '3' });
});

test('parseBody：JSON 之外（401 的 XML）返回 null 而不是抛', () => {
  assert.deepEqual(parseBody('{"code":"10000"}'), { code: '10000' });
  assert.equal(parseBody('<html>401</html>'), null);
  assert.equal(parseBody(''), null);
});

test('pickVehicle：面板/3.0.6 两套字段名都能取到', () => {
  const a = pickVehicle({ data: { vehicleInfo: { vin: 'V1', vehicleName: 'AE5i Pro', bmssoc: '87', hmiRidableMile: '62.3', onlineStatus: 1, otaVersion: '1.2.3' } } });
  assert.equal(a.vin, 'V1');
  assert.equal(a.name, 'AE5i Pro');
  assert.equal(a.soc, 87);
  assert.equal(a.range, 62.3);
  assert.equal(a.online, true);
  assert.equal(a.otaVersion, '1.2.3');

  const b = pickVehicle({ vinNo: 'V2', vehicleType: 'AE5i' });
  assert.equal(b.vin, 'V2');
  assert.equal(b.model, 'AE5i');
  assert.equal(b.soc, null);
});

test('pickVehicle：null / 空对象不抛', () => {
  assert.equal(pickVehicle(null).vin, '');
  assert.equal(pickVehicle({}).soc, null);
});

test('numberOrNull / toBool 的边界', () => {
  assert.equal(numberOrNull(''), null);
  assert.equal(numberOrNull('x'), null);
  assert.equal(numberOrNull(0), 0);
  assert.equal(toBool('1'), true);
  assert.equal(toBool('0'), false);
  assert.equal(toBool('maybe'), null);
});

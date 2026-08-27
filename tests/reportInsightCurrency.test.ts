import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeInsightCurrencyText } from '../src/clinic/ai';

test('AI report money is normalized to Ethiopian birr', () => {
  assert.equal(normalizeInsightCurrencyText('$125,500'), '125,500 ETB');
  assert.equal(normalizeInsightCurrencyText('Revenue is USD 680,000.50'), 'Revenue is 680,000.50 ETB');
  assert.equal(normalizeInsightCurrencyText('Margin is 21%'), 'Margin is 21%');
});

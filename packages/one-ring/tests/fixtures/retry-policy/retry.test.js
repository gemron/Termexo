import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseRetryCount } from './retry.js';

test('uses three retries by default', () => assert.equal(parseRetryCount(undefined), 3));
test('accepts ordinary numeric strings', () => assert.equal(parseRetryCount('4'), 4));

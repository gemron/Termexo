# Retry policy fixture

Fix `parseRetryCount` to accept only integer numbers or decimal digit strings (with optional surrounding whitespace) from 0 through 10, inclusive. Return the default 3 for other input, including fractional numbers, mixed strings, booleans, null, empty strings, NaN and infinity. Zero is a valid value. The function must not throw for unsupported input.

Update meaningful tests and document the accepted values. Do not add dependencies.

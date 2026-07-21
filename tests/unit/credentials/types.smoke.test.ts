import type { Connection, Grant, AccessToken, FlowResult } from '../../../src/main/credentials/types';
import { NotConnectedError, RevokedError, ScopeInsufficientError, SafeStorageUnavailableError, TemporarilyUnavailableError, ProviderNotConfiguredError } from '../../../src/main/credentials/types';

it('error classes are throwable with typed names', () => {
  expect(new NotConnectedError('g').name).toBe('NotConnectedError');
  expect(new RevokedError('g').name).toBe('RevokedError');
  expect(new ScopeInsufficientError('g').name).toBe('ScopeInsufficientError');
  expect(new SafeStorageUnavailableError().name).toBe('SafeStorageUnavailableError');
  expect(new TemporarilyUnavailableError('g').name).toBe('TemporarilyUnavailableError');
  expect(new ProviderNotConfiguredError('g').name).toBe('ProviderNotConfiguredError');
});

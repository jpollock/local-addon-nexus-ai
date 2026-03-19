/**
 * Network Failure Simulator
 *
 * Simulates various network failures for testing error recovery.
 */

import * as http from 'http';
import * as https from 'https';

export class NetworkSimulator {
  private originalRequest: typeof http.request;
  private originalHttpsRequest: typeof https.request;
  private failureMode: 'none' | 'timeout' | 'error' | 'slow' = 'none';
  private failureRate = 0; // 0-1, percentage of requests to fail

  constructor() {
    this.originalRequest = http.request;
    this.originalHttpsRequest = https.request;
  }

  /**
   * Enable network failure simulation
   */
  enable(mode: 'timeout' | 'error' | 'slow', rate: number = 1.0): void {
    this.failureMode = mode;
    this.failureRate = Math.max(0, Math.min(1, rate));

    // Intercept http.request
    (http as any).request = this.interceptRequest.bind(this, 'http');
    (https as any).request = this.interceptRequest.bind(this, 'https');
  }

  /**
   * Disable network failure simulation
   */
  disable(): void {
    this.failureMode = 'none';
    this.failureRate = 0;

    // Restore original methods
    http.request = this.originalRequest;
    https.request = this.originalHttpsRequest;
  }

  private interceptRequest(protocol: 'http' | 'https', ...args: any[]): any {
    // Randomly decide if this request should fail
    if (Math.random() > this.failureRate) {
      // Don't fail this request
      const originalFn = protocol === 'http' ? this.originalRequest : this.originalHttpsRequest;
      return originalFn.apply(http, args);
    }

    // Simulate failure based on mode
    if (this.failureMode === 'timeout') {
      return this.simulateTimeout(protocol, ...args);
    } else if (this.failureMode === 'error') {
      return this.simulateError(protocol, ...args);
    } else if (this.failureMode === 'slow') {
      return this.simulateSlow(protocol, ...args);
    }

    const originalFn = protocol === 'http' ? this.originalRequest : this.originalHttpsRequest;
    return originalFn.apply(http, args);
  }

  private simulateTimeout(protocol: 'http' | 'https', ...args: any[]): any {
    const EventEmitter = require('events');
    const fakeReq = new EventEmitter();

    // Immediately emit timeout
    setTimeout(() => {
      const err = new Error('ETIMEDOUT: Network timeout simulated');
      (err as any).code = 'ETIMEDOUT';
      fakeReq.emit('error', err);
    }, 10);

    return fakeReq;
  }

  private simulateError(protocol: 'http' | 'https', ...args: any[]): any {
    const EventEmitter = require('events');
    const fakeReq = new EventEmitter();

    // Immediately emit connection error
    setTimeout(() => {
      const err = new Error('ECONNREFUSED: Connection refused (simulated)');
      (err as any).code = 'ECONNREFUSED';
      fakeReq.emit('error', err);
    }, 10);

    return fakeReq;
  }

  private simulateSlow(protocol: 'http' | 'https', ...args: any[]): any {
    const originalFn = protocol === 'http' ? this.originalRequest : this.originalHttpsRequest;
    const req = originalFn.apply(http, args);

    // Delay all events by 5 seconds
    const originalEmit = req.emit.bind(req);
    req.emit = (event: string, ...eventArgs: any[]) => {
      setTimeout(() => {
        originalEmit(event, ...eventArgs);
      }, 5000);
      return true;
    };

    return req;
  }
}

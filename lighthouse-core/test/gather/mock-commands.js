/**
 * @license Copyright 2019 Google Inc. All Rights Reserved.
 * Licensed under the Apache License, Version 2.0 (the "License"); you may not use this file except in compliance with the License. You may obtain a copy of the License at http://www.apache.org/licenses/LICENSE-2.0
 * Unless required by applicable law or agreed to in writing, software distributed under the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied. See the License for the specific language governing permissions and limitations under the License.
 */
'use strict';

/**
 * @fileoverview Refer to driver-test.js and source-maps-test.js for intended usage.
 */

/* eslint-env jest */

/**
 * @template {keyof LH.CrdpCommands} C
 * @typedef {((...args: LH.CrdpCommands[C]['paramsType']) => MockResponse<C>) | RecursivePartial<LH.CrdpCommands[C]['returnType']> | Promise<Error>} MockResponse
 */

/**
 * @template {keyof LH.CrdpEvents} E
 * @typedef {RecursivePartial<LH.CrdpEvents[E][0]>} MockEvent
 */

/**
 * Creates a jest mock function whose implementation consumes mocked protocol responses matching the
 * requested command in the order they were mocked.
 *
 * It is decorated with two methods:
 *    - `mockResponse` which pushes protocol message responses for consumption
 *    - `findInvocation` which asserts that `sendCommand` was invoked with the given command and
 *      returns the protocol message argument.
 */
function createMockSendCommandFn() {
  /**
   * Typescript fails to equate template type `C` here with `C` when pushing to this array.
   * Instead of sprinkling a couple ts-ignores, make `command` be any, but leave `C` for just
   * documentation purposes. This is an internal type, so it doesn't matter much.
   * @template {keyof LH.CrdpCommands} C
   * @type {Array<{command: C|any, sessionId?: string, response?: MockResponse<C>, delay?: number}>}
   */
  const mockResponses = [];
  const mockFnImpl = jest.fn().mockImplementation(
    /**
     * @template {keyof LH.CrdpCommands} C
     * @param {C} command
     * @param {string|undefined=} sessionId
     * @param {LH.CrdpCommands[C]['paramsType']} args
     */
    (command, sessionId, ...args) => {
      const indexOfResponse = mockResponses
        .findIndex(entry => entry.command === command && entry.sessionId === sessionId);
      if (indexOfResponse === -1) throw new Error(`${command} unimplemented`);
      const {response, delay} = mockResponses[indexOfResponse];
      mockResponses.splice(indexOfResponse, 1);
      const returnValue = typeof response === 'function' ? response(...args) : response;
      if (delay) return new Promise(resolve => setTimeout(() => resolve(returnValue), delay));
      // @ts-ignore: Some covariant type stuff doesn't work here. idk, I'm not a type scientist.
      return Promise.resolve(returnValue);
    });

  const mockFn = Object.assign(mockFnImpl, {
    /**
     * @template {keyof LH.CrdpCommands} C
     * @param {C} command
     * @param {MockResponse<C>=} response
     * @param {number=} delay
     */
    mockResponse(command, response, delay) {
      mockResponses.push({command, response, delay});
      return mockFn;
    },
    /**
     * @template {keyof LH.CrdpCommands} C
     * @param {C} command
     * @param {string} sessionId
     * @param {MockResponse<C>=} response
     * @param {number=} delay
     */
    mockResponseToSession(command, sessionId, response, delay) {
      mockResponses.push({command, sessionId, response, delay});
      return mockFn;
    },
    /**
     * @param {keyof LH.CrdpCommands} command
     * @param {string=} sessionId
     */
    findInvocation(command, sessionId) {
      expect(mockFn).toHaveBeenCalledWith(command, sessionId, expect.anything());
      return mockFn.mock.calls.find(call => call[0] === command && call[1] === sessionId)[2];
    },
  });

  return mockFn;
}

/**
 * Creates a jest mock function whose implementation invokes `.on`/`.once` listeners after a setTimeout tick.
 * Closely mirrors `createMockSendCommandFn`.
 *
 * It is decorated with two methods:
 *    - `mockEvent` which pushes protocol event payload for consumption
 *    - `findListener` which asserts that `on` was invoked with the given event name and
 *      returns the listener .
 */
function createMockOnceFn() {
  /**
   * @template {keyof LH.CrdpEvents} E
   * @type {Array<{event: E|any, response?: MockEvent<E>}>}
   */
  const mockEvents = [];
  const mockFnImpl = jest.fn().mockImplementation((eventName, listener) => {
    const indexOfResponse = mockEvents.findIndex(entry => entry.event === eventName);
    if (indexOfResponse === -1) return;
    const {response} = mockEvents[indexOfResponse];
    mockEvents.splice(indexOfResponse, 1);
    // Wait a tick because real events never fire immediately
    setTimeout(() => listener(response), 0);
  });

  const mockFn = Object.assign(mockFnImpl, {
    ...mockFnImpl,
    /**
     * @template {keyof LH.CrdpEvents} E
     * @param {E} event
     * @param {MockEvent<E>} response
     */
    mockEvent(event, response) {
      mockEvents.push({event, response});
      return mockFn;
    },
    /**
     * @param {keyof LH.CrdpEvents} event
     */
    findListener(event) {
      expect(mockFn).toHaveBeenCalledWith(event, expect.anything());
      return mockFn.mock.calls.find(call => call[0] === event)[1];
    },
  });

  return mockFn;
}

/**
 * Very much like `createMockOnceFn`, but will fire all the events (not just one for every call).
 * So it's good for .on w/ many events.
 */
function createMockOnFn() {
  /**
   * @template {keyof LH.CrdpEvents} E
   * @type {Array<{event: E|any, response?: MockEvent<E>}>}
   */
  const mockEvents = [];
  const mockFnImpl = jest.fn().mockImplementation((eventName, listener) => {
    const events = mockEvents.filter(entry => entry.event === eventName);
    if (!events.length) return;
    for (const event of events) {
      const indexOfEvent = mockEvents.indexOf(event);
      mockEvents.splice(indexOfEvent, 1);
    }
    // Wait a tick because real events never fire immediately
    setTimeout(() => {
      for (const event of events) {
        listener(event.response);
      }
    }, 0);
  });

  const mockFn = Object.assign(mockFnImpl, {
    ...mockFnImpl,
    /**
     * @template {keyof LH.CrdpEvents} E
     * @param {E} event
     * @param {MockEvent<E>} response
     */
    mockEvent(event, response) {
      mockEvents.push({event, response});
      return mockFn;
    },
    /**
     * @param {keyof LH.CrdpEvents} event
     */
    findListener(event) {
      expect(mockFn).toHaveBeenCalledWith(event, expect.anything());
      return mockFn.mock.calls.find(call => call[0] === event)[1];
    },
  });

  return mockFn;
}

module.exports = {
  createMockSendCommandFn,
  createMockOnceFn,
  createMockOnFn,
};

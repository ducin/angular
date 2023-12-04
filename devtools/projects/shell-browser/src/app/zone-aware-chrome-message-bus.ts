/**
 * @license
 * Copyright Google LLC All Rights Reserved.
 *
 * Use of this source code is governed by an MIT-style license that can be
 * found in the LICENSE file at https://angular.io/license
 */

import {NgZone} from '@angular/core';
import {Events, MessageBus, Parameters} from 'protocol';

import {ChromeMessageBus} from './chrome-message-bus';

export class ZoneAwareChromeMessageBus extends MessageBus<Events> {
  private _bus: ChromeMessageBus;
  constructor(port: chrome.runtime.Port, private _ngZone: NgZone) {
    super();
    this._bus = new ChromeMessageBus(port);
  }

  override on<E extends keyof Events>(topic: E, cb: Events[E]): void {
    this._bus.on(topic, (...args: any): void => {
      this._ngZone.run(() => (cb as any)(...args));
    });
  }

  override once<E extends keyof Events>(topic: E, cb: Events[E]): void {
    this._bus.once(topic, (...args: any): void => {
      this._ngZone.run(() => (cb as any)(...args));
    });
  }

  override emit<E extends keyof Events>(topic: E, args?: Parameters<Events[E]>): boolean {
    this._ngZone.run(() => this._bus.emit(topic, args));
    return true;
  }

  override destroy(): void {
    this._bus.destroy();
  }
}

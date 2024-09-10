/**
 * @license
 * Copyright Google LLC All Rights Reserved.
 *
 * Use of this source code is governed by an MIT-style license that can be
 * found in the LICENSE file at https://angular.io/license
 */

import {Component, computed, effect, inject, Injector, signal} from '@angular/core';
import {initializeGraph} from './signal-graph-builder';
import {signalBroker} from './MessageBroker';
import {DebugSignalGraph} from './signal-graph-types';
import {getSignalGraph} from '@angular/core/src/render3/util/discovery_utils';
import {CommonModule} from '@angular/common';

@Component({
  selector: 'ng-signal-graph',
  standalone: true,
  imports: [CommonModule],
  template: `
      <span id="graph"></span>
      <ol>
        <li>signalPrimitive: {{ signalPrimitive() }}</li>
        <li>computedPrimitive: {{ computedPrimitive() }}</li>
        <li>signalObject: {{ signalObject() | json }}</li>
        <li>computedObject: {{ computedObject() | json }}</li>
      </ol>
    `,
})
export class SignalGraphComponent {
  #injector = inject(Injector);

  signalPrimitive = signal(123);
  computedPrimitive = computed(() => this.signalPrimitive() ** 2);
  signalObject = signal({name: 'John', age: 40});
  computedObject = computed(() => {
    const original = this.signalObject();
    return {...original, age: original.age + 1};
  });

  myEffect = effect(() => {
    console.log(
      this.signalPrimitive(),
      this.computedPrimitive(),
      this.signalObject(),
      this.computedObject(),
    );
  });

  ngOnInit() {
    initializeGraph(signalBroker);

    let exampleGraphDefinition: DebugSignalGraph<unknown> = {
      edges: [
        {producer: 1, consumer: 0},
        {producer: 2, consumer: 0},
        {producer: 3, consumer: 0},
        {producer: 1, consumer: 2},
        {producer: 4, consumer: 3},
        {producer: 2, consumer: 3},
        {producer: 5, consumer: 3},
        {producer: 1, consumer: 6},
        {producer: 2, consumer: 6},
      ],
      nodes: [
        {label: 'app-sample-properties', /*value: 'ref to Component',*/ type: 'template'},
        {label: 'basicSignal', value: 123, type: 'signal'},
        {label: 'computedSignal', value: 15129, type: 'computed'},
        {label: 'computedObject', value: {value: 123}, type: 'computed'},
        {label: 'signalObject', value: {another: 'value'}, type: 'signal'},
        {label: 'outsideSignal', value: 'signal located outside of the component', type: 'signal'},
        {label: 'effect', /*value: 'ref to Effect',*/ type: 'effect'},
      ],
    };

    exampleGraphDefinition = getSignalGraph(this.#injector);
    console.log(exampleGraphDefinition);

    signalBroker.publish('nodes-set', exampleGraphDefinition.nodes);
    signalBroker.publish('edges-set', exampleGraphDefinition.edges);
  }
}

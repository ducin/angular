/**
 * @license
 * Copyright Google LLC All Rights Reserved.
 *
 * Use of this source code is governed by an MIT-style license that can be
 * found in the LICENSE file at https://angular.io/license
 */

import {Component, computed, ElementRef, EventEmitter, Input, Output, signal, ViewChild, ViewEncapsulation} from '@angular/core';

import {ZippyComponent} from './zippy.component';

@Component({
  selector: 'app-demo-component',
  templateUrl: './demo-app.component.html',
  styleUrls: ['./demo-app.component.scss'],
  encapsulation: ViewEncapsulation.None,
})
export class DemoAppComponent {
  @ViewChild(ZippyComponent) zippy: ZippyComponent;
  @ViewChild('elementReference') elementRef: ElementRef;

  exampleNumber = 40
  exampleString = 'John'
  exampleObject = {name: 'John', age: 40}

  @Input('input_one') inputOne = 'input one';
  @Input() inputTwo = 'input two';

  @Output() outputOne = new EventEmitter();
  @Output('output_two') outputTwo = new EventEmitter();

  signalPrimitive = signal(123);
  computedPrimitive = computed(() => this.signalPrimitive() ** 2);
  signalObject = signal({name: 'John', age: 40});
  computedObject = computed(() => {
    const original = this.signalObject();
    return {...original, age: original.age + 1};
  });

  getTitle(): '► Click to expand'|'▼ Click to collapse' {
    if (!this.zippy || !this.zippy.visible) {
      return '► Click to expand';
    }
    return '▼ Click to collapse';
  }
}

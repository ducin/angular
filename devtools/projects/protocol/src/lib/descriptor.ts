/**
 * @license
 * Copyright Google LLC All Rights Reserved.
 *
 * Use of this source code is governed by an MIT-style license that can be
 * found in the LICENSE file at https://angular.io/license
 */

import {Descriptor} from './messages';

export function getDescriptorInitialValue(descriptor: Descriptor) {
  const valueOrPreview = descriptor.value || descriptor.preview;
  return valueOrPreview
}

export function getDisplayedPreview(descriptor: Descriptor) {
  return descriptor.preview
}

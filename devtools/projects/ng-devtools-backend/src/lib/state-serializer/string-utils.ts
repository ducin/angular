/**
 * @license
 * Copyright Google LLC All Rights Reserved.
 *
 * Use of this source code is governed by an MIT-style license that can be
 * found in the LICENSE file at https://angular.io/license
 */

export const truncate = (str: string, max = 20): string => {
  if (str.length > max) {
    return str.substring(0, max) + '...';
  }
  return str;
};

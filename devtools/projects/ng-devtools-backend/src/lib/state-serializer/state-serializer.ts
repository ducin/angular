/**
 * @license
 * Copyright Google LLC All Rights Reserved.
 *
 * Use of this source code is governed by an MIT-style license that can be
 * found in the LICENSE file at https://angular.io/license
 */

import {Descriptor, NestedProp, PropType} from 'protocol';

import {getKeys} from './object-utils';
import {getPropType} from './prop-type';
import {createLevelSerializedDescriptor, createNestedSerializedDescriptor, createShallowSerializedDescriptor, PropertyData,} from './serialized-descriptor-factory';

// todo(aleksanderbodurri) pull this out of this file
const METADATA_PROPERTY_NAME = '__ngContext__';

const ignoreList = new Set([METADATA_PROPERTY_NAME, '__ngSimpleChanges__']);

const MAX_LEVEL = 1;

const nestedSerializer =
    (instance: any, propName: string|number, nodes: NestedProp[], currentLevel = 0,
     level = MAX_LEVEL): Descriptor => {
      const serializableInstance = instance[propName];
      const propData:
          PropertyData = {prop: serializableInstance, type: getPropType(serializableInstance)};

      if (currentLevel < level) {
        const a = nestedSerializerContinuation(nodes, level);
        return levelSerializer(instance, propName, currentLevel, level, a);
      }

      switch (propData.type) {
        case PropType.Array:
        case PropType.Object:
          return createNestedSerializedDescriptor(
              instance, propName, propData, {level, currentLevel}, nodes, nestedSerializer);
        default:
          return createShallowSerializedDescriptor(instance, propName, propData);
      }
    };

const nestedSerializerContinuation = (nodes: NestedProp[], level: number) =>
    (instance: any, propName: string|number, nestedLevel?: number, _?: number) => {
      const idx = nodes.findIndex((v) => v.name === propName);
      if (idx < 0) {
        // The property is not specified in the query.
        return nestedSerializer(instance, propName, [], nestedLevel, level);
      }
      return nestedSerializer(instance, propName, nodes[idx].children, nestedLevel, level);
    };

function levelSerializer(
    instance: any, propName: string|number, currentLevel = 0, level = MAX_LEVEL,
    continuation = levelSerializer): Descriptor {
  const serializableInstance = instance[propName];
  const propData:
      PropertyData = {prop: serializableInstance, type: getPropType(serializableInstance)};

  switch (propData.type) {
    case PropType.Array:
    case PropType.Object:
      return createLevelSerializedDescriptor(
          instance, propName, propData, {level, currentLevel}, continuation);
    default:
      return createShallowSerializedDescriptor(instance, propName, propData);
  }
}

export function serializeDirectiveState(
    instance: object, levels = MAX_LEVEL): {[key: string]: Descriptor} {
  const result: Record<string, Descriptor> = {};
  getKeys(instance).forEach((prop) => {
    if (typeof prop === 'string' && ignoreList.has(prop)) {
      return;
    }
    // TODO: investigate why this call didn't match the signature
    result[prop] = levelSerializer(instance, prop, null as any, 0, levels as any);
  });
  return result;
}

export const deeplySerializeSelectedProperties =
    (instance: any, props: NestedProp[]): {[name: string]: Descriptor} => {
      const result: Record<string, Descriptor> = {};
      getKeys(instance).forEach((prop) => {
        if (ignoreList.has(prop)) {
          return;
        }
        const idx = props.findIndex((v) => v.name === prop);
        if (idx < 0) {
          result[prop] = levelSerializer(instance, prop);
        } else {
          result[prop] = nestedSerializer(instance, prop, props[idx].children);
        }
      });
      return result;
    };

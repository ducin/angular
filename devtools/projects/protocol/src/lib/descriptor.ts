import {Descriptor} from './messages';

export function getDescriptorInitialValue(descriptor: Descriptor) {
  return descriptor.value || descriptor.preview
}

/**
 * @license
 * Copyright Google LLC All Rights Reserved.
 *
 * Use of this source code is governed by an MIT-style license that can be
 * found in the LICENSE file at https://angular.io/license
 */

import {ComputedNode, SIGNAL, SignalNode} from '@angular/core/primitives/signals';
import {ChangeDetectionStrategy} from '../../change_detection/constants';
import {Injector} from '../../di/injector';
import {ViewEncapsulation} from '../../metadata/view';
import {throwError} from '../../util/assert';
import {assertLView, assertTNode} from '../assert';
import {
  discoverLocalRefs,
  getComponentAtNodeIndex,
  getDirectivesAtNodeIndex,
  getLContext,
  readPatchedLView,
} from '../context_discovery';
import {getComponentDef, getDirectiveDef} from '../definition';
import {NodeInjector, getNodeInjectorLView, getNodeInjectorTNode} from '../di';
import {DirectiveDef} from '../interfaces/definition';
import {TElementNode, TNode, TNodeProviderIndexes} from '../interfaces/node';
import {
  CLEANUP,
  CONTEXT,
  FLAGS,
  HOST,
  LView,
  LViewFlags,
  REACTIVE_TEMPLATE_CONSUMER,
  TVIEW,
  TViewType,
} from '../interfaces/view';

import {getRootContext} from './view_traversal_utils';
import {getLViewParent, unwrapRNode} from './view_utils';
import {isLView} from '../interfaces/type_checks';
import {getFrameworkDIDebugData} from '../debug/framework_injector_profiler';
import {Watch, WatchNode} from '@angular/core/primitives/signals/src/watch';
import {R3Injector} from '../../di/r3_injector';
import {ReactiveLViewConsumer} from '../reactive_lview_consumer';

/**
 * Retrieves the component instance associated with a given DOM element.
 *
 * @usageNotes
 * Given the following DOM structure:
 *
 * ```html
 * <app-root>
 *   <div>
 *     <child-comp></child-comp>
 *   </div>
 * </app-root>
 * ```
 *
 * Calling `getComponent` on `<child-comp>` will return the instance of `ChildComponent`
 * associated with this DOM element.
 *
 * Calling the function on `<app-root>` will return the `MyApp` instance.
 *
 *
 * @param element DOM element from which the component should be retrieved.
 * @returns Component instance associated with the element or `null` if there
 *    is no component associated with it.
 *
 * @publicApi
 * @globalApi ng
 */
export function getComponent<T>(element: Element): T | null {
  ngDevMode && assertDomElement(element);
  const context = getLContext(element);
  if (context === null) return null;

  if (context.component === undefined) {
    const lView = context.lView;
    if (lView === null) {
      return null;
    }
    context.component = getComponentAtNodeIndex(context.nodeIndex, lView);
  }

  return context.component as unknown as T;
}

/**
 * If inside an embedded view (e.g. `*ngIf` or `*ngFor`), retrieves the context of the embedded
 * view that the element is part of. Otherwise retrieves the instance of the component whose view
 * owns the element (in this case, the result is the same as calling `getOwningComponent`).
 *
 * @param element Element for which to get the surrounding component instance.
 * @returns Instance of the component that is around the element or null if the element isn't
 *    inside any component.
 *
 * @publicApi
 * @globalApi ng
 */
export function getContext<T extends {}>(element: Element): T | null {
  assertDomElement(element);
  const context = getLContext(element)!;
  const lView = context ? context.lView : null;
  return lView === null ? null : (lView[CONTEXT] as T);
}

/**
 * Retrieves the component instance whose view contains the DOM element.
 *
 * For example, if `<child-comp>` is used in the template of `<app-comp>`
 * (i.e. a `ViewChild` of `<app-comp>`), calling `getOwningComponent` on `<child-comp>`
 * would return `<app-comp>`.
 *
 * @param elementOrDir DOM element, component or directive instance
 *    for which to retrieve the root components.
 * @returns Component instance whose view owns the DOM element or null if the element is not
 *    part of a component view.
 *
 * @publicApi
 * @globalApi ng
 */
export function getOwningComponent<T>(elementOrDir: Element | {}): T | null {
  const context = getLContext(elementOrDir)!;
  let lView = context ? context.lView : null;
  if (lView === null) return null;

  let parent: LView | null;
  while (lView[TVIEW].type === TViewType.Embedded && (parent = getLViewParent(lView)!)) {
    lView = parent;
  }
  return lView[FLAGS] & LViewFlags.IsRoot ? null : (lView[CONTEXT] as unknown as T);
}

/**
 * Retrieves all root components associated with a DOM element, directive or component instance.
 * Root components are those which have been bootstrapped by Angular.
 *
 * @param elementOrDir DOM element, component or directive instance
 *    for which to retrieve the root components.
 * @returns Root components associated with the target object.
 *
 * @publicApi
 * @globalApi ng
 */
export function getRootComponents(elementOrDir: Element | {}): {}[] {
  const lView = readPatchedLView<{}>(elementOrDir);
  return lView !== null ? [getRootContext(lView)] : [];
}

/**
 * Retrieves an `Injector` associated with an element, component or directive instance.
 *
 * @param elementOrDir DOM element, component or directive instance for which to
 *    retrieve the injector.
 * @returns Injector associated with the element, component or directive instance.
 *
 * @publicApi
 * @globalApi ng
 */
export function getInjector(elementOrDir: Element | {}): Injector {
  const context = getLContext(elementOrDir)!;
  const lView = context ? context.lView : null;
  if (lView === null) return Injector.NULL;

  const tNode = lView[TVIEW].data[context.nodeIndex] as TElementNode;
  return new NodeInjector(tNode, lView);
}

/**
 * Retrieve a set of injection tokens at a given DOM node.
 *
 * @param element Element for which the injection tokens should be retrieved.
 */
export function getInjectionTokens(element: Element): any[] {
  const context = getLContext(element)!;
  const lView = context ? context.lView : null;
  if (lView === null) return [];
  const tView = lView[TVIEW];
  const tNode = tView.data[context.nodeIndex] as TNode;
  const providerTokens: any[] = [];
  const startIndex = tNode.providerIndexes & TNodeProviderIndexes.ProvidersStartIndexMask;
  const endIndex = tNode.directiveEnd;
  for (let i = startIndex; i < endIndex; i++) {
    let value = tView.data[i];
    if (isDirectiveDefHack(value)) {
      // The fact that we sometimes store Type and sometimes DirectiveDef in this location is a
      // design flaw.  We should always store same type so that we can be monomorphic. The issue
      // is that for Components/Directives we store the def instead the type. The correct behavior
      // is that we should always be storing injectable type in this location.
      value = value.type;
    }
    providerTokens.push(value);
  }
  return providerTokens;
}

/**
 * Retrieves directive instances associated with a given DOM node. Does not include
 * component instances.
 *
 * @usageNotes
 * Given the following DOM structure:
 *
 * ```html
 * <app-root>
 *   <button my-button></button>
 *   <my-comp></my-comp>
 * </app-root>
 * ```
 *
 * Calling `getDirectives` on `<button>` will return an array with an instance of the `MyButton`
 * directive that is associated with the DOM node.
 *
 * Calling `getDirectives` on `<my-comp>` will return an empty array.
 *
 * @param node DOM node for which to get the directives.
 * @returns Array of directives associated with the node.
 *
 * @publicApi
 * @globalApi ng
 */
export function getDirectives(node: Node): {}[] {
  // Skip text nodes because we can't have directives associated with them.
  if (node instanceof Text) {
    return [];
  }

  const context = getLContext(node)!;
  const lView = context ? context.lView : null;
  if (lView === null) {
    return [];
  }

  const tView = lView[TVIEW];
  const nodeIndex = context.nodeIndex;
  if (!tView?.data[nodeIndex]) {
    return [];
  }
  if (context.directives === undefined) {
    context.directives = getDirectivesAtNodeIndex(nodeIndex, lView);
  }

  // The `directives` in this case are a named array called `LComponentView`. Clone the
  // result so we don't expose an internal data structure in the user's console.
  return context.directives === null ? [] : [...context.directives];
}

/**
 * Partial metadata for a given directive instance.
 * This information might be useful for debugging purposes or tooling.
 * Currently only `inputs` and `outputs` metadata is available.
 *
 * @publicApi
 */
export interface DirectiveDebugMetadata {
  inputs: Record<string, string>;
  outputs: Record<string, string>;
}

/**
 * Partial metadata for a given component instance.
 * This information might be useful for debugging purposes or tooling.
 * Currently the following fields are available:
 *  - inputs
 *  - outputs
 *  - encapsulation
 *  - changeDetection
 *
 * @publicApi
 */
export interface ComponentDebugMetadata extends DirectiveDebugMetadata {
  encapsulation: ViewEncapsulation;
  changeDetection: ChangeDetectionStrategy;
}

/**
 * Returns the debug (partial) metadata for a particular directive or component instance.
 * The function accepts an instance of a directive or component and returns the corresponding
 * metadata.
 *
 * @param directiveOrComponentInstance Instance of a directive or component
 * @returns metadata of the passed directive or component
 *
 * @publicApi
 * @globalApi ng
 */
export function getDirectiveMetadata(
  directiveOrComponentInstance: any,
): ComponentDebugMetadata | DirectiveDebugMetadata | null {
  const {constructor} = directiveOrComponentInstance;
  if (!constructor) {
    throw new Error('Unable to find the instance constructor');
  }
  // In case a component inherits from a directive, we may have component and directive metadata
  // To ensure we don't get the metadata of the directive, we want to call `getComponentDef` first.
  const componentDef = getComponentDef(constructor);
  if (componentDef) {
    const inputs = extractInputDebugMetadata(componentDef.inputs);
    return {
      inputs,
      outputs: componentDef.outputs,
      encapsulation: componentDef.encapsulation,
      changeDetection: componentDef.onPush
        ? ChangeDetectionStrategy.OnPush
        : ChangeDetectionStrategy.Default,
    };
  }
  const directiveDef = getDirectiveDef(constructor);
  if (directiveDef) {
    const inputs = extractInputDebugMetadata(directiveDef.inputs);
    return {inputs, outputs: directiveDef.outputs};
  }
  return null;
}

/**
 * Retrieve map of local references.
 *
 * The references are retrieved as a map of local reference name to element or directive instance.
 *
 * @param target DOM element, component or directive instance for which to retrieve
 *    the local references.
 */
export function getLocalRefs(target: {}): {[key: string]: any} {
  const context = getLContext(target);
  if (context === null) return {};

  if (context.localRefs === undefined) {
    const lView = context.lView;
    if (lView === null) {
      return {};
    }
    context.localRefs = discoverLocalRefs(lView, context.nodeIndex);
  }

  return context.localRefs || {};
}

/**
 * Retrieves the host element of a component or directive instance.
 * The host element is the DOM element that matched the selector of the directive.
 *
 * @param componentOrDirective Component or directive instance for which the host
 *     element should be retrieved.
 * @returns Host element of the target.
 *
 * @publicApi
 * @globalApi ng
 */
export function getHostElement(componentOrDirective: {}): Element {
  return getLContext(componentOrDirective)!.native as unknown as Element;
}

/**
 * Retrieves the rendered text for a given component.
 *
 * This function retrieves the host element of a component and
 * and then returns the `textContent` for that element. This implies
 * that the text returned will include re-projected content of
 * the component as well.
 *
 * @param component The component to return the content text for.
 */
export function getRenderedText(component: any): string {
  const hostElement = getHostElement(component);
  return hostElement.textContent || '';
}

/**
 * Event listener configuration returned from `getListeners`.
 * @publicApi
 */
export interface Listener {
  /** Name of the event listener. */
  name: string;
  /** Element that the listener is bound to. */
  element: Element;
  /** Callback that is invoked when the event is triggered. */
  callback: (value: any) => any;
  /** Whether the listener is using event capturing. */
  useCapture: boolean;
  /**
   * Type of the listener (e.g. a native DOM event or a custom @Output).
   */
  type: 'dom' | 'output';
}

/**
 * Retrieves a list of event listeners associated with a DOM element. The list does include host
 * listeners, but it does not include event listeners defined outside of the Angular context
 * (e.g. through `addEventListener`).
 *
 * @usageNotes
 * Given the following DOM structure:
 *
 * ```html
 * <app-root>
 *   <div (click)="doSomething()"></div>
 * </app-root>
 * ```
 *
 * Calling `getListeners` on `<div>` will return an object that looks as follows:
 *
 * ```ts
 * {
 *   name: 'click',
 *   element: <div>,
 *   callback: () => doSomething(),
 *   useCapture: false
 * }
 * ```
 *
 * @param element Element for which the DOM listeners should be retrieved.
 * @returns Array of event listeners on the DOM element.
 *
 * @publicApi
 * @globalApi ng
 */
export function getListeners(element: Element): Listener[] {
  ngDevMode && assertDomElement(element);
  const lContext = getLContext(element);
  const lView = lContext === null ? null : lContext.lView;
  if (lView === null) return [];

  const tView = lView[TVIEW];
  const lCleanup = lView[CLEANUP];
  const tCleanup = tView.cleanup;
  const listeners: Listener[] = [];
  if (tCleanup && lCleanup) {
    for (let i = 0; i < tCleanup.length; ) {
      const firstParam = tCleanup[i++];
      const secondParam = tCleanup[i++];
      if (typeof firstParam === 'string') {
        const name: string = firstParam;
        const listenerElement = unwrapRNode(lView[secondParam]) as any as Element;
        const callback: (value: any) => any = lCleanup[tCleanup[i++]];
        const useCaptureOrIndx = tCleanup[i++];
        // if useCaptureOrIndx is boolean then report it as is.
        // if useCaptureOrIndx is positive number then it in unsubscribe method
        // if useCaptureOrIndx is negative number then it is a Subscription
        const type =
          typeof useCaptureOrIndx === 'boolean' || useCaptureOrIndx >= 0 ? 'dom' : 'output';
        const useCapture = typeof useCaptureOrIndx === 'boolean' ? useCaptureOrIndx : false;
        if (element == listenerElement) {
          listeners.push({element, name, callback, useCapture, type});
        }
      }
    }
  }
  listeners.sort(sortListeners);
  return listeners;
}

function sortListeners(a: Listener, b: Listener) {
  if (a.name == b.name) return 0;
  return a.name < b.name ? -1 : 1;
}

/**
 * This function should not exist because it is megamorphic and only mostly correct.
 *
 * See call site for more info.
 */
function isDirectiveDefHack(obj: any): obj is DirectiveDef<any> {
  return (
    obj.type !== undefined &&
    obj.declaredInputs !== undefined &&
    obj.findHostDirectiveDefs !== undefined
  );
}

/**
 * Retrieve the component `LView` from component/element.
 *
 * NOTE: `LView` is a private and should not be leaked outside.
 *       Don't export this method to `ng.*` on window.
 *
 * @param target DOM element or component instance for which to retrieve the LView.
 */
export function getComponentLView(target: any): LView {
  const lContext = getLContext(target)!;
  const nodeIndx = lContext.nodeIndex;
  const lView = lContext.lView!;
  ngDevMode && assertLView(lView);
  const componentLView = lView[nodeIndx];
  ngDevMode && assertLView(componentLView);
  return componentLView;
}

/** Asserts that a value is a DOM Element. */
function assertDomElement(value: any) {
  if (typeof Element !== 'undefined' && !(value instanceof Element)) {
    throw new Error('Expecting instance of DOM Element');
  }
}

/**
 * A directive definition holds additional metadata using bitwise flags to indicate
 * for example whether it is signal based.
 *
 * This information needs to be separate from the `publicName -> minifiedName`
 * mappings for backwards compatibility.
 */
function extractInputDebugMetadata<T>(inputs: DirectiveDef<T>['inputs']) {
  const res: DirectiveDebugMetadata['inputs'] = {};

  for (const key in inputs) {
    if (!inputs.hasOwnProperty(key)) {
      continue;
    }

    const value = inputs[key];
    if (value === undefined) {
      continue;
    }

    let minifiedName: string;

    if (Array.isArray(value)) {
      minifiedName = value[0];
      // flags are not used for now.
      // TODO: Consider exposing flag information in discovery.
    } else {
      minifiedName = value;
    }

    res[key] = minifiedName;
  }

  return res;
}

type SignalGraphNode<T> = SignalNode<T> | ComputedNode<T> | WatchNode | ReactiveLViewConsumer;

interface DebugSignalNode<T> {
  type: 'signal';
  label: string;
  value: T;
}
interface DebugEffectNode {
  type: 'effect';
  label: string;
}

interface DebugComputedNode<T> {
  type: 'computed';
  label: string;
  value: T;
}

interface DebugTemplateNode {
  type: 'template';
  label: string;
}

type DebugSignalGraphNode<T> =
  | DebugSignalNode<T>
  | DebugEffectNode
  | DebugComputedNode<T>
  | DebugTemplateNode;

interface DebugSignalGraphEdge {
  from: number;
  to: number;
}

interface DebugSignalGraph<T> {
  nodes: DebugSignalGraphNode<T>[];
  edges: DebugSignalGraphEdge[];
}

function isComputedNode<T>(node: SignalGraphNode<T>): node is ComputedNode<T> {
  return (node as ComputedNode<T>).computation !== undefined;
}

function isTemplateNode<T>(node: SignalGraphNode<T>): node is ReactiveLViewConsumer {
  return (
    (node as ReactiveLViewConsumer).lView !== undefined &&
    isLView((node as ReactiveLViewConsumer).lView)
  );
}

function isEffectNode<T>(node: SignalGraphNode<T>): node is WatchNode {
  return (node as WatchNode).cleanupFn !== undefined;
}

export function getSignalGraph(injector: Injector): DebugSignalGraph<unknown> {
  if (!(injector instanceof NodeInjector) && !(injector instanceof R3Injector)) {
    return throwError('getSignals must be called with a NodeInjector or an R3Injector');
  }

  const signalDependenciesMap = new Map<SignalGraphNode<unknown>, Set<SignalGraphNode<unknown>>>();

  // if the injector is a NodeInjector, we need to extract the signals from the template
  // otherwise if it is an R3Injector, we proceed as normal without this extra step since both cases
  // require us to extract signals from the injector
  if (injector instanceof NodeInjector) {
    const tNode = getNodeInjectorTNode(injector)!;
    const lView = getNodeInjectorLView(injector);

    assertTNode(tNode);
    assertLView(lView);
    const templateLView = lView[tNode.index];
    if (templateLView) {
      const templateConsumer = templateLView[REACTIVE_TEMPLATE_CONSUMER];

      if (templateConsumer) {
        extractSignalNodesAndEdgesFromRoot(templateConsumer, signalDependenciesMap);
      }
    }
  }

  const effects = extractEffectsFromInjector(injector);
  for (const effect of effects) {
    const {watcher} = effect;
    const signalRoot = watcher[SIGNAL];
    extractSignalNodesAndEdgesFromRoot(signalRoot, signalDependenciesMap);
  }

  return extractNodesAndEdgesFromSignalMap(signalDependenciesMap);
}

function extractNodesAndEdgesFromSignalMap(
  signalMap: Map<SignalGraphNode<unknown>, Set<SignalGraphNode<unknown>>>,
): {
  nodes: DebugSignalGraphNode<unknown>[];
  edges: DebugSignalGraphEdge[];
} {
  const nodes = Array.from(signalMap.keys());
  const debugSignalGraphNodes = nodes.map((signalGraphNode: SignalGraphNode<unknown>) => {
    if (isComputedNode(signalGraphNode)) {
      return {
        label: signalGraphNode.debugName,
        value: signalGraphNode.value,
        type: 'computed',
      };
    }

    if (isTemplateNode(signalGraphNode)) {
      return {
        label: signalGraphNode.lView?.[HOST]?.tagName?.toLowerCase?.(),
        value: undefined,
        type: 'template',
      };
    }

    if (isEffectNode(signalGraphNode)) {
      return {
        label: signalGraphNode.debugName,
        value: undefined,
        type: 'effect',
      };
    }

    return {
      label: signalGraphNode.debugName,
      value: signalGraphNode.value,
      type: 'signal',
    };
  }) as DebugSignalGraphNode<unknown>[];

  const edges: DebugSignalGraphEdge[] = [];
  for (const [node, producers] of signalMap.entries()) {
    for (const producer of producers) {
      edges.push({from: nodes.indexOf(node), to: nodes.indexOf(producer)});
    }
  }

  return {nodes: debugSignalGraphNodes, edges};
}

function extractEffectsFromInjector(injector: Injector) {
  let diResolver: Injector | LView<unknown> = injector;
  if (injector instanceof NodeInjector) {
    const lView = getNodeInjectorLView(injector)!;
    diResolver = lView;
  }

  const {resolverToEffects} = getFrameworkDIDebugData();
  return resolverToEffects.get(diResolver) ?? [];
}

function extractSignalNodesAndEdgesFromRoot(
  node: SignalGraphNode<unknown>,
  signalDependenciesMap: Map<SignalGraphNode<unknown>, Set<SignalGraphNode<unknown>>>,
): Map<SignalGraphNode<unknown>, Set<SignalGraphNode<unknown>>> {
  if (signalDependenciesMap.has(node)) {
    return signalDependenciesMap;
  }

  signalDependenciesMap.set(node, new Set());

  const {producerNode} = node;

  for (const producer of producerNode ?? []) {
    signalDependenciesMap.get(node)!.add(producer as SignalNode<unknown>);
    extractSignalNodesAndEdgesFromRoot(producer as SignalNode<unknown>, signalDependenciesMap);
  }

  return signalDependenciesMap;
}

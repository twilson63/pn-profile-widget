(function () {
    'use strict';

    function noop() { }
    function assign(tar, src) {
        // @ts-ignore
        for (const k in src)
            tar[k] = src[k];
        return tar;
    }
    function is_promise(value) {
        return value && typeof value === 'object' && typeof value.then === 'function';
    }
    function run(fn) {
        return fn();
    }
    function blank_object() {
        return Object.create(null);
    }
    function run_all(fns) {
        fns.forEach(run);
    }
    function is_function(thing) {
        return typeof thing === 'function';
    }
    function safe_not_equal(a, b) {
        return a != a ? b == b : a !== b || ((a && typeof a === 'object') || typeof a === 'function');
    }
    let src_url_equal_anchor;
    function src_url_equal(element_src, url) {
        if (!src_url_equal_anchor) {
            src_url_equal_anchor = document.createElement('a');
        }
        src_url_equal_anchor.href = url;
        return element_src === src_url_equal_anchor.href;
    }
    function is_empty(obj) {
        return Object.keys(obj).length === 0;
    }
    function create_slot(definition, ctx, $$scope, fn) {
        if (definition) {
            const slot_ctx = get_slot_context(definition, ctx, $$scope, fn);
            return definition[0](slot_ctx);
        }
    }
    function get_slot_context(definition, ctx, $$scope, fn) {
        return definition[1] && fn
            ? assign($$scope.ctx.slice(), definition[1](fn(ctx)))
            : $$scope.ctx;
    }
    function get_slot_changes(definition, $$scope, dirty, fn) {
        if (definition[2] && fn) {
            const lets = definition[2](fn(dirty));
            if ($$scope.dirty === undefined) {
                return lets;
            }
            if (typeof lets === 'object') {
                const merged = [];
                const len = Math.max($$scope.dirty.length, lets.length);
                for (let i = 0; i < len; i += 1) {
                    merged[i] = $$scope.dirty[i] | lets[i];
                }
                return merged;
            }
            return $$scope.dirty | lets;
        }
        return $$scope.dirty;
    }
    function update_slot_base(slot, slot_definition, ctx, $$scope, slot_changes, get_slot_context_fn) {
        if (slot_changes) {
            const slot_context = get_slot_context(slot_definition, ctx, $$scope, get_slot_context_fn);
            slot.p(slot_context, slot_changes);
        }
    }
    function get_all_dirty_from_scope($$scope) {
        if ($$scope.ctx.length > 32) {
            const dirty = [];
            const length = $$scope.ctx.length / 32;
            for (let i = 0; i < length; i++) {
                dirty[i] = -1;
            }
            return dirty;
        }
        return -1;
    }
    function append(target, node) {
        target.appendChild(node);
    }
    function insert(target, node, anchor) {
        target.insertBefore(node, anchor || null);
    }
    function detach(node) {
        node.parentNode.removeChild(node);
    }
    function element(name) {
        return document.createElement(name);
    }
    function text(data) {
        return document.createTextNode(data);
    }
    function space() {
        return text(' ');
    }
    function listen(node, event, handler, options) {
        node.addEventListener(event, handler, options);
        return () => node.removeEventListener(event, handler, options);
    }
    function prevent_default(fn) {
        return function (event) {
            event.preventDefault();
            // @ts-ignore
            return fn.call(this, event);
        };
    }
    function attr(node, attribute, value) {
        if (value == null)
            node.removeAttribute(attribute);
        else if (node.getAttribute(attribute) !== value)
            node.setAttribute(attribute, value);
    }
    function children(element) {
        return Array.from(element.childNodes);
    }
    function set_data(text, data) {
        data = '' + data;
        if (text.wholeText !== data)
            text.data = data;
    }
    function set_style(node, key, value, important) {
        if (value === null) {
            node.style.removeProperty(key);
        }
        else {
            node.style.setProperty(key, value, important ? 'important' : '');
        }
    }
    function custom_event(type, detail, { bubbles = false, cancelable = false } = {}) {
        const e = document.createEvent('CustomEvent');
        e.initCustomEvent(type, bubbles, cancelable, detail);
        return e;
    }

    let current_component;
    function set_current_component(component) {
        current_component = component;
    }
    function get_current_component() {
        if (!current_component)
            throw new Error('Function called outside component initialization');
        return current_component;
    }
    function createEventDispatcher() {
        const component = get_current_component();
        return (type, detail, { cancelable = false } = {}) => {
            const callbacks = component.$$.callbacks[type];
            if (callbacks) {
                // TODO are there situations where events could be dispatched
                // in a server (non-DOM) environment?
                const event = custom_event(type, detail, { cancelable });
                callbacks.slice().forEach(fn => {
                    fn.call(component, event);
                });
                return !event.defaultPrevented;
            }
            return true;
        };
    }

    const dirty_components = [];
    const binding_callbacks = [];
    const render_callbacks = [];
    const flush_callbacks = [];
    const resolved_promise = Promise.resolve();
    let update_scheduled = false;
    function schedule_update() {
        if (!update_scheduled) {
            update_scheduled = true;
            resolved_promise.then(flush);
        }
    }
    function add_render_callback(fn) {
        render_callbacks.push(fn);
    }
    // flush() calls callbacks in this order:
    // 1. All beforeUpdate callbacks, in order: parents before children
    // 2. All bind:this callbacks, in reverse order: children before parents.
    // 3. All afterUpdate callbacks, in order: parents before children. EXCEPT
    //    for afterUpdates called during the initial onMount, which are called in
    //    reverse order: children before parents.
    // Since callbacks might update component values, which could trigger another
    // call to flush(), the following steps guard against this:
    // 1. During beforeUpdate, any updated components will be added to the
    //    dirty_components array and will cause a reentrant call to flush(). Because
    //    the flush index is kept outside the function, the reentrant call will pick
    //    up where the earlier call left off and go through all dirty components. The
    //    current_component value is saved and restored so that the reentrant call will
    //    not interfere with the "parent" flush() call.
    // 2. bind:this callbacks cannot trigger new flush() calls.
    // 3. During afterUpdate, any updated components will NOT have their afterUpdate
    //    callback called a second time; the seen_callbacks set, outside the flush()
    //    function, guarantees this behavior.
    const seen_callbacks = new Set();
    let flushidx = 0; // Do *not* move this inside the flush() function
    function flush() {
        const saved_component = current_component;
        do {
            // first, call beforeUpdate functions
            // and update components
            while (flushidx < dirty_components.length) {
                const component = dirty_components[flushidx];
                flushidx++;
                set_current_component(component);
                update(component.$$);
            }
            set_current_component(null);
            dirty_components.length = 0;
            flushidx = 0;
            while (binding_callbacks.length)
                binding_callbacks.pop()();
            // then, once components are updated, call
            // afterUpdate functions. This may cause
            // subsequent updates...
            for (let i = 0; i < render_callbacks.length; i += 1) {
                const callback = render_callbacks[i];
                if (!seen_callbacks.has(callback)) {
                    // ...so guard against infinite loops
                    seen_callbacks.add(callback);
                    callback();
                }
            }
            render_callbacks.length = 0;
        } while (dirty_components.length);
        while (flush_callbacks.length) {
            flush_callbacks.pop()();
        }
        update_scheduled = false;
        seen_callbacks.clear();
        set_current_component(saved_component);
    }
    function update($$) {
        if ($$.fragment !== null) {
            $$.update();
            run_all($$.before_update);
            const dirty = $$.dirty;
            $$.dirty = [-1];
            $$.fragment && $$.fragment.p($$.ctx, dirty);
            $$.after_update.forEach(add_render_callback);
        }
    }
    const outroing = new Set();
    let outros;
    function group_outros() {
        outros = {
            r: 0,
            c: [],
            p: outros // parent group
        };
    }
    function check_outros() {
        if (!outros.r) {
            run_all(outros.c);
        }
        outros = outros.p;
    }
    function transition_in(block, local) {
        if (block && block.i) {
            outroing.delete(block);
            block.i(local);
        }
    }
    function transition_out(block, local, detach, callback) {
        if (block && block.o) {
            if (outroing.has(block))
                return;
            outroing.add(block);
            outros.c.push(() => {
                outroing.delete(block);
                if (callback) {
                    if (detach)
                        block.d(1);
                    callback();
                }
            });
            block.o(local);
        }
    }

    function handle_promise(promise, info) {
        const token = info.token = {};
        function update(type, index, key, value) {
            if (info.token !== token)
                return;
            info.resolved = value;
            let child_ctx = info.ctx;
            if (key !== undefined) {
                child_ctx = child_ctx.slice();
                child_ctx[key] = value;
            }
            const block = type && (info.current = type)(child_ctx);
            let needs_flush = false;
            if (info.block) {
                if (info.blocks) {
                    info.blocks.forEach((block, i) => {
                        if (i !== index && block) {
                            group_outros();
                            transition_out(block, 1, 1, () => {
                                if (info.blocks[i] === block) {
                                    info.blocks[i] = null;
                                }
                            });
                            check_outros();
                        }
                    });
                }
                else {
                    info.block.d(1);
                }
                block.c();
                transition_in(block, 1);
                block.m(info.mount(), info.anchor);
                needs_flush = true;
            }
            info.block = block;
            if (info.blocks)
                info.blocks[index] = block;
            if (needs_flush) {
                flush();
            }
        }
        if (is_promise(promise)) {
            const current_component = get_current_component();
            promise.then(value => {
                set_current_component(current_component);
                update(info.then, 1, info.value, value);
                set_current_component(null);
            }, error => {
                set_current_component(current_component);
                update(info.catch, 2, info.error, error);
                set_current_component(null);
                if (!info.hasCatch) {
                    throw error;
                }
            });
            // if we previously had a then/catch block, destroy it
            if (info.current !== info.pending) {
                update(info.pending, 0);
                return true;
            }
        }
        else {
            if (info.current !== info.then) {
                update(info.then, 1, info.value, promise);
                return true;
            }
            info.resolved = promise;
        }
    }
    function update_await_block_branch(info, ctx, dirty) {
        const child_ctx = ctx.slice();
        const { resolved } = info;
        if (info.current === info.then) {
            child_ctx[info.value] = resolved;
        }
        if (info.current === info.catch) {
            child_ctx[info.error] = resolved;
        }
        info.block.p(child_ctx, dirty);
    }
    function create_component(block) {
        block && block.c();
    }
    function mount_component(component, target, anchor, customElement) {
        const { fragment, on_mount, on_destroy, after_update } = component.$$;
        fragment && fragment.m(target, anchor);
        if (!customElement) {
            // onMount happens before the initial afterUpdate
            add_render_callback(() => {
                const new_on_destroy = on_mount.map(run).filter(is_function);
                if (on_destroy) {
                    on_destroy.push(...new_on_destroy);
                }
                else {
                    // Edge case - component was destroyed immediately,
                    // most likely as a result of a binding initialising
                    run_all(new_on_destroy);
                }
                component.$$.on_mount = [];
            });
        }
        after_update.forEach(add_render_callback);
    }
    function destroy_component(component, detaching) {
        const $$ = component.$$;
        if ($$.fragment !== null) {
            run_all($$.on_destroy);
            $$.fragment && $$.fragment.d(detaching);
            // TODO null out other refs, including component.$$ (but need to
            // preserve final state?)
            $$.on_destroy = $$.fragment = null;
            $$.ctx = [];
        }
    }
    function make_dirty(component, i) {
        if (component.$$.dirty[0] === -1) {
            dirty_components.push(component);
            schedule_update();
            component.$$.dirty.fill(0);
        }
        component.$$.dirty[(i / 31) | 0] |= (1 << (i % 31));
    }
    function init(component, options, instance, create_fragment, not_equal, props, append_styles, dirty = [-1]) {
        const parent_component = current_component;
        set_current_component(component);
        const $$ = component.$$ = {
            fragment: null,
            ctx: null,
            // state
            props,
            update: noop,
            not_equal,
            bound: blank_object(),
            // lifecycle
            on_mount: [],
            on_destroy: [],
            on_disconnect: [],
            before_update: [],
            after_update: [],
            context: new Map(options.context || (parent_component ? parent_component.$$.context : [])),
            // everything else
            callbacks: blank_object(),
            dirty,
            skip_bound: false,
            root: options.target || parent_component.$$.root
        };
        append_styles && append_styles($$.root);
        let ready = false;
        $$.ctx = instance
            ? instance(component, options.props || {}, (i, ret, ...rest) => {
                const value = rest.length ? rest[0] : ret;
                if ($$.ctx && not_equal($$.ctx[i], $$.ctx[i] = value)) {
                    if (!$$.skip_bound && $$.bound[i])
                        $$.bound[i](value);
                    if (ready)
                        make_dirty(component, i);
                }
                return ret;
            })
            : [];
        $$.update();
        ready = true;
        run_all($$.before_update);
        // `false` as a special case of no DOM component
        $$.fragment = create_fragment ? create_fragment($$.ctx) : false;
        if (options.target) {
            if (options.hydrate) {
                const nodes = children(options.target);
                // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
                $$.fragment && $$.fragment.l(nodes);
                nodes.forEach(detach);
            }
            else {
                // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
                $$.fragment && $$.fragment.c();
            }
            if (options.intro)
                transition_in(component.$$.fragment);
            mount_component(component, options.target, options.anchor, options.customElement);
            flush();
        }
        set_current_component(parent_component);
    }
    /**
     * Base class for Svelte components. Used when dev=false.
     */
    class SvelteComponent {
        $destroy() {
            destroy_component(this, 1);
            this.$destroy = noop;
        }
        $on(type, callback) {
            const callbacks = (this.$$.callbacks[type] || (this.$$.callbacks[type] = []));
            callbacks.push(callback);
            return () => {
                const index = callbacks.indexOf(callback);
                if (index !== -1)
                    callbacks.splice(index, 1);
            };
        }
        $set($$props) {
            if (this.$$set && !is_empty($$props)) {
                this.$$.skip_bound = true;
                this.$$set($$props);
                this.$$.skip_bound = false;
            }
        }
    }

    /* src/components/modal.svelte generated by Svelte v3.48.0 */

    function create_if_block$1(ctx) {
    	let div;
    	let button;
    	let t1;
    	let mounted;
    	let dispose;
    	let if_block = /*cancel*/ ctx[3] && create_if_block_1$1(ctx);

    	return {
    		c() {
    			div = element("div");
    			button = element("button");
    			button.textContent = "OK";
    			t1 = space();
    			if (if_block) if_block.c();
    			attr(button, "class", "btn");
    			attr(div, "class", "modal-action");
    		},
    		m(target, anchor) {
    			insert(target, div, anchor);
    			append(div, button);
    			append(div, t1);
    			if (if_block) if_block.m(div, null);

    			if (!mounted) {
    				dispose = listen(button, "click", /*okClick*/ ctx[4]);
    				mounted = true;
    			}
    		},
    		p(ctx, dirty) {
    			if (/*cancel*/ ctx[3]) {
    				if (if_block) {
    					if_block.p(ctx, dirty);
    				} else {
    					if_block = create_if_block_1$1(ctx);
    					if_block.c();
    					if_block.m(div, null);
    				}
    			} else if (if_block) {
    				if_block.d(1);
    				if_block = null;
    			}
    		},
    		d(detaching) {
    			if (detaching) detach(div);
    			if (if_block) if_block.d();
    			mounted = false;
    			dispose();
    		}
    	};
    }

    // (24:8) {#if cancel}
    function create_if_block_1$1(ctx) {
    	let button;
    	let mounted;
    	let dispose;

    	return {
    		c() {
    			button = element("button");
    			button.textContent = "Cancel";
    			attr(button, "class", "btn btn-outline");
    		},
    		m(target, anchor) {
    			insert(target, button, anchor);

    			if (!mounted) {
    				dispose = listen(button, "click", /*cancelClick*/ ctx[5]);
    				mounted = true;
    			}
    		},
    		p: noop,
    		d(detaching) {
    			if (detaching) detach(button);
    			mounted = false;
    			dispose();
    		}
    	};
    }

    function create_fragment$2(ctx) {
    	let input;
    	let t0;
    	let div1;
    	let div0;
    	let t1;
    	let current;
    	let mounted;
    	let dispose;
    	const default_slot_template = /*#slots*/ ctx[7].default;
    	const default_slot = create_slot(default_slot_template, ctx, /*$$scope*/ ctx[6], null);
    	let if_block = /*ok*/ ctx[2] && create_if_block$1(ctx);

    	return {
    		c() {
    			input = element("input");
    			t0 = space();
    			div1 = element("div");
    			div0 = element("div");
    			if (default_slot) default_slot.c();
    			t1 = space();
    			if (if_block) if_block.c();
    			attr(input, "type", "checkbox");
    			attr(input, "id", /*id*/ ctx[1]);
    			attr(input, "class", "modal-toggle");
    			attr(div0, "class", "modal-box");
    			attr(div1, "class", "modal");
    		},
    		m(target, anchor) {
    			insert(target, input, anchor);
    			input.checked = /*open*/ ctx[0];
    			insert(target, t0, anchor);
    			insert(target, div1, anchor);
    			append(div1, div0);

    			if (default_slot) {
    				default_slot.m(div0, null);
    			}

    			append(div0, t1);
    			if (if_block) if_block.m(div0, null);
    			current = true;

    			if (!mounted) {
    				dispose = listen(input, "change", /*input_change_handler*/ ctx[8]);
    				mounted = true;
    			}
    		},
    		p(ctx, [dirty]) {
    			if (!current || dirty & /*id*/ 2) {
    				attr(input, "id", /*id*/ ctx[1]);
    			}

    			if (dirty & /*open*/ 1) {
    				input.checked = /*open*/ ctx[0];
    			}

    			if (default_slot) {
    				if (default_slot.p && (!current || dirty & /*$$scope*/ 64)) {
    					update_slot_base(
    						default_slot,
    						default_slot_template,
    						ctx,
    						/*$$scope*/ ctx[6],
    						!current
    						? get_all_dirty_from_scope(/*$$scope*/ ctx[6])
    						: get_slot_changes(default_slot_template, /*$$scope*/ ctx[6], dirty, null),
    						null
    					);
    				}
    			}

    			if (/*ok*/ ctx[2]) {
    				if (if_block) {
    					if_block.p(ctx, dirty);
    				} else {
    					if_block = create_if_block$1(ctx);
    					if_block.c();
    					if_block.m(div0, null);
    				}
    			} else if (if_block) {
    				if_block.d(1);
    				if_block = null;
    			}
    		},
    		i(local) {
    			if (current) return;
    			transition_in(default_slot, local);
    			current = true;
    		},
    		o(local) {
    			transition_out(default_slot, local);
    			current = false;
    		},
    		d(detaching) {
    			if (detaching) detach(input);
    			if (detaching) detach(t0);
    			if (detaching) detach(div1);
    			if (default_slot) default_slot.d(detaching);
    			if (if_block) if_block.d();
    			mounted = false;
    			dispose();
    		}
    	};
    }

    function instance$2($$self, $$props, $$invalidate) {
    	let { $$slots: slots = {}, $$scope } = $$props;
    	let { id = "1234" } = $$props;
    	let { open = false } = $$props;
    	let { ok = true } = $$props;
    	let { cancel = false } = $$props;
    	const dispatch = createEventDispatcher();

    	function okClick() {
    		$$invalidate(0, open = false);
    		dispatch("click");
    	}

    	function cancelClick() {
    		dispatch("cancel");
    	}

    	function input_change_handler() {
    		open = this.checked;
    		$$invalidate(0, open);
    	}

    	$$self.$$set = $$props => {
    		if ('id' in $$props) $$invalidate(1, id = $$props.id);
    		if ('open' in $$props) $$invalidate(0, open = $$props.open);
    		if ('ok' in $$props) $$invalidate(2, ok = $$props.ok);
    		if ('cancel' in $$props) $$invalidate(3, cancel = $$props.cancel);
    		if ('$$scope' in $$props) $$invalidate(6, $$scope = $$props.$$scope);
    	};

    	return [
    		open,
    		id,
    		ok,
    		cancel,
    		okClick,
    		cancelClick,
    		$$scope,
    		slots,
    		input_change_handler
    	];
    }

    class Modal extends SvelteComponent {
    	constructor(options) {
    		super();
    		init(this, options, instance$2, create_fragment$2, safe_not_equal, { id: 1, open: 0, ok: 2, cancel: 3 });
    	}
    }

    /* src/components/mailform.svelte generated by Svelte v3.48.0 */

    function create_fragment$1(ctx) {
    	let h1;
    	let t1;
    	let div0;
    	let t5;
    	let form;
    	let div4;
    	let input0;
    	let t6;
    	let div1;
    	let t9;
    	let div2;
    	let t12;
    	let div3;
    	let t15;
    	let div5;
    	let button0;
    	let t16;
    	let t17;
    	let button1;
    	let mounted;
    	let dispose;

    	return {
    		c() {
    			h1 = element("h1");
    			h1.textContent = "Write to me!";
    			t1 = space();
    			div0 = element("div");

    			div0.innerHTML = `<p>To send a message, you need an Arweave wallet, if you do not have an Arweave
    wallet go to and install ArConnect in your browser.</p> 
  <a class="link" href="https://arconnect.io" target="_blank" rel="noreferrer">ArConnect</a>`;

    			t5 = space();
    			form = element("form");
    			div4 = element("div");
    			input0 = element("input");
    			t6 = space();
    			div1 = element("div");

    			div1.innerHTML = `<label class="label" for="subject">Subject</label> 
      <input class="input input-bordered" type="text" placeholder="Subject" name="subject" id="subject"/>`;

    			t9 = space();
    			div2 = element("div");

    			div2.innerHTML = `<label class="label" for="content">Mail contents</label> 
      <textarea class="textarea textarea-bordered h-16" id="content" name="content" placeholder="Hello there..."></textarea>`;

    			t12 = space();
    			div3 = element("div");

    			div3.innerHTML = `<label class="label" for="donate">(Optional) Send me AR</label> 
      <input class="input input-bordered" type="text" placeholder="0 AR" name="donate" id="donate"/>`;

    			t15 = space();
    			div5 = element("div");
    			button0 = element("button");
    			t16 = text("Send");
    			t17 = space();
    			button1 = element("button");
    			button1.textContent = "Cancel";
    			attr(h1, "class", "text-3xl modal-title");
    			attr(div0, "class", "alert alert-info my-8 flex-col");
    			attr(input0, "type", "hidden");
    			attr(input0, "name", "to");
    			input0.value = /*address*/ ctx[0];
    			attr(div1, "class", "form-control");
    			attr(div2, "class", "form-control");
    			attr(div3, "class", "form-control");
    			attr(div4, "class", "modal-body");
    			attr(button0, "class", "btn");
    			button0.disabled = sending;
    			attr(button1, "type", "button");
    			attr(button1, "class", "btn btn-outline");
    			attr(div5, "class", "mt-8 modal-action");
    			attr(form, "id", "weavemailForm");
    		},
    		m(target, anchor) {
    			insert(target, h1, anchor);
    			insert(target, t1, anchor);
    			insert(target, div0, anchor);
    			insert(target, t5, anchor);
    			insert(target, form, anchor);
    			append(form, div4);
    			append(div4, input0);
    			append(div4, t6);
    			append(div4, div1);
    			append(div4, t9);
    			append(div4, div2);
    			append(div4, t12);
    			append(div4, div3);
    			append(form, t15);
    			append(form, div5);
    			append(div5, button0);
    			append(button0, t16);
    			append(div5, t17);
    			append(div5, button1);

    			if (!mounted) {
    				dispose = [
    					listen(button1, "click", /*click_handler*/ ctx[3]),
    					listen(form, "submit", prevent_default(/*send*/ ctx[2]))
    				];

    				mounted = true;
    			}
    		},
    		p(ctx, [dirty]) {
    			if (dirty & /*address*/ 1) {
    				input0.value = /*address*/ ctx[0];
    			}
    		},
    		i: noop,
    		o: noop,
    		d(detaching) {
    			if (detaching) detach(h1);
    			if (detaching) detach(t1);
    			if (detaching) detach(div0);
    			if (detaching) detach(t5);
    			if (detaching) detach(form);
    			mounted = false;
    			run_all(dispose);
    		}
    	};
    }

    let sending = false;

    async function generate_random_bytes(length) {
    	var array = new Uint8Array(length);
    	window.crypto.getRandomValues(array);
    	return array;
    }

    function instance$1($$self, $$props, $$invalidate) {
    	let { address = "" } = $$props;
    	const dispatch = createEventDispatcher();

    	const arweave = Arweave.init({
    		host: "arweave.net",
    		protocol: "https",
    		port: 443
    	});

    	async function send(e) {
    		dispatch("sending");

    		if (!arweave) {
    			alert("Arweave is required!");
    		}

    		if (!arweaveWallet) {
    			alert("ArConnect is required!");
    		}

    		const formData = new FormData(e.target);
    		const address = formData.get("to");
    		var content = formData.get("content");
    		const subject = formData.get("subject");
    		const mailTagUnixTime = Math.round(new Date().getTime() / 1000);
    		var tokens = formData.get("donate");

    		if (tokens == "") {
    			tokens = "0";
    		}

    		tokens = arweave.ar.arToWinston(tokens);
    		var pub_key = await get_public_key(address);

    		if (pub_key == undefined) {
    			alert("Recipient has to send a transaction to the network, first!");
    			return;
    		}

    		content = await encrypt_mail(content, subject, pub_key);

    		try {
    			var tx = await arweave.createTransaction({
    				target: address,
    				data: arweave.utils.concatBuffers([content]),
    				quantity: tokens
    			});

    			tx.addTag("App-Name", "permamail");
    			tx.addTag("App-Version", "0.0.2");
    			tx.addTag("Unix-Time", mailTagUnixTime);
    			await arweave.transactions.sign(tx, "use_wallet");
    			await arweave.transactions.post(tx);
    			alert("Mail dispatched!");
    			e.target.reset();
    			dispatch("mail", tx.id);
    		} catch(err) {
    			alert("ERROR trying to send mail!");
    			e.target.reset();
    			dispatch("cancel");
    		}
    	}

    	async function encrypt_mail(content, subject, pub_key) {
    		var content_encoder = new TextEncoder();
    		var newFormat = JSON.stringify({ subject, body: content });
    		var mail_buf = content_encoder.encode(newFormat);
    		var key_buf = await generate_random_bytes(256);

    		// Encrypt data segments
    		var encrypted_mail = await arweave.crypto.encrypt(mail_buf, key_buf);

    		var encrypted_key = await window.crypto.subtle.encrypt({ name: "RSA-OAEP" }, pub_key, key_buf);

    		// Concatenate and return them
    		return arweave.utils.concatBuffers([encrypted_key, encrypted_mail]);
    	}

    	async function get_public_key(address) {
    		var txid = await arweave.wallets.getLastTransactionID(address);

    		if (txid == "") {
    			return undefined;
    		}

    		var tx = await arweave.transactions.get(txid);

    		if (tx == undefined) {
    			return undefined;
    		}

    		arweave.utils.b64UrlToBuffer(tx.owner);

    		var keyData = {
    			kty: "RSA",
    			e: "AQAB",
    			n: tx.owner,
    			alg: "RSA-OAEP-256",
    			ext: true
    		};

    		var algo = {
    			name: "RSA-OAEP",
    			hash: { name: "SHA-256" }
    		};

    		return await crypto.subtle.importKey("jwk", keyData, algo, false, ["encrypt"]);
    	}

    	const click_handler = () => dispatch("cancel");

    	$$self.$$set = $$props => {
    		if ('address' in $$props) $$invalidate(0, address = $$props.address);
    	};

    	return [address, dispatch, send, click_handler];
    }

    class Mailform extends SvelteComponent {
    	constructor(options) {
    		super();
    		init(this, options, instance$1, create_fragment$1, safe_not_equal, { address: 0 });
    	}
    }

    const arweave = Arweave.init({
      host: "arweave.net",
      protocol: "https",
      port: 443,
    });

    function getProfile(addr) {
      const query = `
  query {
    transactions(
      owners: ["${addr}"],
      tags: [
        { name: "Protocol", values: ["PermaProfile-v0.1"]}
      ]
    ) {
      edges {
        node {
          id
          owner {
            address
          },
          tags {
            name
            value
          }
        }
      }
    }
  }  
  `;
      return arweave.api.post('graphql', { query })
        .then(({ data: { data: { transactions: { edges } } } }) => edges.map(e => e.node)[0])
        .then(record => arweave.api.get(record.id))
        .then(({ data }) => data)

    }

    /* src/widget.svelte generated by Svelte v3.48.0 */

    function create_catch_block(ctx) {
    	let t;

    	return {
    		c() {
    			t = text("Profile not found!");
    		},
    		m(target, anchor) {
    			insert(target, t, anchor);
    		},
    		p: noop,
    		i: noop,
    		o: noop,
    		d(detaching) {
    			if (detaching) detach(t);
    		}
    	};
    }

    // (39:38)    <div class="md:hidden h-[400px]">     <div       class="bg-[url('{profile.background ||         defaultBackground}
    function create_then_block(ctx) {
    	let div2;
    	let div1;
    	let figure;
    	let img0;
    	let img0_src_value;
    	let t0;
    	let div0;
    	let p0;
    	let t1_value = /*profile*/ ctx[10].name + "";
    	let t1;
    	let t2;
    	let p1;
    	let t3_value = /*profile*/ ctx[10].bio + "";
    	let t3;
    	let t4;
    	let ul0;
    	let show_if_17 = !isEmpty(/*profile*/ ctx[10].links.facebook);
    	let t5;
    	let show_if_16 = !isEmpty(/*profile*/ ctx[10].links.linkedin);
    	let t6;
    	let show_if_15 = !isEmpty(/*profile*/ ctx[10].links.github);
    	let t7;
    	let show_if_14 = !isEmpty(/*profile*/ ctx[10].links.discord);
    	let t8;
    	let show_if_13 = !isEmpty(/*profile*/ ctx[10].owner);
    	let t9;
    	let show_if_12 = !isEmpty(/*profile*/ ctx[10].links.twitch);
    	let t10;
    	let show_if_11 = !isEmpty(/*profile*/ ctx[10].links.instagram);
    	let t11;
    	let show_if_10 = !isEmpty(/*profile*/ ctx[10].links.youtube);
    	let t12;
    	let show_if_9 = !isEmpty(/*profile*/ ctx[10].links.twitter);
    	let div1_class_value;
    	let t13;
    	let div7;
    	let div6;
    	let div5;
    	let ul1;
    	let show_if_8 = !isEmpty(/*profile*/ ctx[10].links.facebook);
    	let t14;
    	let show_if_7 = !isEmpty(/*profile*/ ctx[10].links.linkedin);
    	let t15;
    	let show_if_6 = !isEmpty(/*profile*/ ctx[10].links.github);
    	let t16;
    	let show_if_5 = !isEmpty(/*profile*/ ctx[10].links.discord);
    	let t17;
    	let show_if_4 = !isEmpty(/*profile*/ ctx[10].owner);
    	let t18;
    	let show_if_3 = !isEmpty(/*profile*/ ctx[10].links.twitch);
    	let t19;
    	let show_if_2 = !isEmpty(/*profile*/ ctx[10].links.instagram);
    	let t20;
    	let show_if_1 = !isEmpty(/*profile*/ ctx[10].links.youtube);
    	let t21;
    	let show_if = !isEmpty(/*profile*/ ctx[10].links.twitter);
    	let t22;
    	let div4;
    	let img1;
    	let img1_src_value;
    	let t23;
    	let div3;
    	let p2;
    	let t24_value = /*profile*/ ctx[10].name + "";
    	let t24;
    	let t25;
    	let p3;
    	let t26_value = /*profile*/ ctx[10].bio + "";
    	let t26;
    	let div6_class_value;
    	let t27;
    	let modal;
    	let current;
    	let if_block0 = show_if_17 && create_if_block_17(ctx);
    	let if_block1 = show_if_16 && create_if_block_16(ctx);
    	let if_block2 = show_if_15 && create_if_block_15(ctx);
    	let if_block3 = show_if_14 && create_if_block_14(ctx);
    	let if_block4 = show_if_13 && create_if_block_13(ctx);
    	let if_block5 = show_if_12 && create_if_block_12(ctx);
    	let if_block6 = show_if_11 && create_if_block_11(ctx);
    	let if_block7 = show_if_10 && create_if_block_10(ctx);
    	let if_block8 = show_if_9 && create_if_block_9(ctx);
    	let if_block9 = show_if_8 && create_if_block_8(ctx);
    	let if_block10 = show_if_7 && create_if_block_7(ctx);
    	let if_block11 = show_if_6 && create_if_block_6(ctx);
    	let if_block12 = show_if_5 && create_if_block_5(ctx);
    	let if_block13 = show_if_4 && create_if_block_4(ctx);
    	let if_block14 = show_if_3 && create_if_block_3(ctx);
    	let if_block15 = show_if_2 && create_if_block_2(ctx);
    	let if_block16 = show_if_1 && create_if_block_1(ctx);
    	let if_block17 = show_if && create_if_block(ctx);

    	modal = new Modal({
    			props: {
    				open: /*mailDialog*/ ctx[1],
    				ok: false,
    				$$slots: { default: [create_default_slot_1] },
    				$$scope: { ctx }
    			}
    		});

    	return {
    		c() {
    			div2 = element("div");
    			div1 = element("div");
    			figure = element("figure");
    			img0 = element("img");
    			t0 = space();
    			div0 = element("div");
    			p0 = element("p");
    			t1 = text(t1_value);
    			t2 = space();
    			p1 = element("p");
    			t3 = text(t3_value);
    			t4 = space();
    			ul0 = element("ul");
    			if (if_block0) if_block0.c();
    			t5 = space();
    			if (if_block1) if_block1.c();
    			t6 = space();
    			if (if_block2) if_block2.c();
    			t7 = space();
    			if (if_block3) if_block3.c();
    			t8 = space();
    			if (if_block4) if_block4.c();
    			t9 = space();
    			if (if_block5) if_block5.c();
    			t10 = space();
    			if (if_block6) if_block6.c();
    			t11 = space();
    			if (if_block7) if_block7.c();
    			t12 = space();
    			if (if_block8) if_block8.c();
    			t13 = space();
    			div7 = element("div");
    			div6 = element("div");
    			div5 = element("div");
    			ul1 = element("ul");
    			if (if_block9) if_block9.c();
    			t14 = space();
    			if (if_block10) if_block10.c();
    			t15 = space();
    			if (if_block11) if_block11.c();
    			t16 = space();
    			if (if_block12) if_block12.c();
    			t17 = space();
    			if (if_block13) if_block13.c();
    			t18 = space();
    			if (if_block14) if_block14.c();
    			t19 = space();
    			if (if_block15) if_block15.c();
    			t20 = space();
    			if (if_block16) if_block16.c();
    			t21 = space();
    			if (if_block17) if_block17.c();
    			t22 = space();
    			div4 = element("div");
    			img1 = element("img");
    			t23 = space();
    			div3 = element("div");
    			p2 = element("p");
    			t24 = text(t24_value);
    			t25 = space();
    			p3 = element("p");
    			t26 = text(t26_value);
    			t27 = space();
    			create_component(modal.$$.fragment);
    			attr(img0, "alt", "avatar");
    			if (!src_url_equal(img0.src, img0_src_value = /*profile*/ ctx[10].avatar || /*defaultAvatar*/ ctx[4])) attr(img0, "src", img0_src_value);
    			attr(img0, "class", "shadow-xl rounded-full border-4 h-[250px] w-[250px] bg-base-300");
    			attr(figure, "class", "flex justify-center");
    			attr(p0, "class", "m-1 text-3xl tracking-tight text-base-600");
    			attr(p1, "class", "m-1 text-xl text-base-600");
    			attr(div0, "class", "flex flex-col justify-center ml-8");
    			attr(ul0, "class", "w-full flex flex-row-reverse space-x-4 p-5");
    			attr(div1, "class", div1_class_value = "bg-[url('" + (/*profile*/ ctx[10].background || /*defaultBackground*/ ctx[3]) + "')] bg-cover bg-no-repeat w-full h-[100px] mb-[10px]");
    			attr(div2, "class", "md:hidden h-[400px]");
    			attr(ul1, "class", "w-full flex flex-row-reverse p-5");
    			attr(img1, "alt", "avatar");
    			if (!src_url_equal(img1.src, img1_src_value = /*profile*/ ctx[10].avatar || /*defaultAvatar*/ ctx[4])) attr(img1, "src", img1_src_value);
    			attr(img1, "class", "ml-5 mr-5 shadow-xl rounded-full border-4 h-[250px] w-[250px] bg-base-300");
    			attr(p2, "class", "m-1 text-3xl tracking-tight text-base-600");
    			attr(p3, "class", "m-1 text-xl text-base-600");
    			attr(div3, "class", "flex flex-col justify-center");
    			attr(div4, "class", "w-full flex m-5 absolute top-[200px] left-0");
    			attr(div5, "class", "w-full h-full flex flex-col justify-between relative");
    			attr(div6, "class", div6_class_value = "bg-[url('" + (/*profile*/ ctx[10].background || /*defaultBackground*/ ctx[3]) + "')] bg-cover bg-no-repeat w-full h-[300px] mb-[50px]");
    			attr(div7, "class", "hidden md:block h-[475px]");
    		},
    		m(target, anchor) {
    			insert(target, div2, anchor);
    			append(div2, div1);
    			append(div1, figure);
    			append(figure, img0);
    			append(div1, t0);
    			append(div1, div0);
    			append(div0, p0);
    			append(p0, t1);
    			append(div0, t2);
    			append(div0, p1);
    			append(p1, t3);
    			append(div1, t4);
    			append(div1, ul0);
    			if (if_block0) if_block0.m(ul0, null);
    			append(ul0, t5);
    			if (if_block1) if_block1.m(ul0, null);
    			append(ul0, t6);
    			if (if_block2) if_block2.m(ul0, null);
    			append(ul0, t7);
    			if (if_block3) if_block3.m(ul0, null);
    			append(ul0, t8);
    			if (if_block4) if_block4.m(ul0, null);
    			append(ul0, t9);
    			if (if_block5) if_block5.m(ul0, null);
    			append(ul0, t10);
    			if (if_block6) if_block6.m(ul0, null);
    			append(ul0, t11);
    			if (if_block7) if_block7.m(ul0, null);
    			append(ul0, t12);
    			if (if_block8) if_block8.m(ul0, null);
    			insert(target, t13, anchor);
    			insert(target, div7, anchor);
    			append(div7, div6);
    			append(div6, div5);
    			append(div5, ul1);
    			if (if_block9) if_block9.m(ul1, null);
    			append(ul1, t14);
    			if (if_block10) if_block10.m(ul1, null);
    			append(ul1, t15);
    			if (if_block11) if_block11.m(ul1, null);
    			append(ul1, t16);
    			if (if_block12) if_block12.m(ul1, null);
    			append(ul1, t17);
    			if (if_block13) if_block13.m(ul1, null);
    			append(ul1, t18);
    			if (if_block14) if_block14.m(ul1, null);
    			append(ul1, t19);
    			if (if_block15) if_block15.m(ul1, null);
    			append(ul1, t20);
    			if (if_block16) if_block16.m(ul1, null);
    			append(ul1, t21);
    			if (if_block17) if_block17.m(ul1, null);
    			append(div5, t22);
    			append(div5, div4);
    			append(div4, img1);
    			append(div4, t23);
    			append(div4, div3);
    			append(div3, p2);
    			append(p2, t24);
    			append(div3, t25);
    			append(div3, p3);
    			append(p3, t26);
    			insert(target, t27, anchor);
    			mount_component(modal, target, anchor);
    			current = true;
    		},
    		p(ctx, dirty) {
    			if (!current || dirty & /*addr*/ 1 && !src_url_equal(img0.src, img0_src_value = /*profile*/ ctx[10].avatar || /*defaultAvatar*/ ctx[4])) {
    				attr(img0, "src", img0_src_value);
    			}

    			if ((!current || dirty & /*addr*/ 1) && t1_value !== (t1_value = /*profile*/ ctx[10].name + "")) set_data(t1, t1_value);
    			if ((!current || dirty & /*addr*/ 1) && t3_value !== (t3_value = /*profile*/ ctx[10].bio + "")) set_data(t3, t3_value);
    			if (dirty & /*addr*/ 1) show_if_17 = !isEmpty(/*profile*/ ctx[10].links.facebook);

    			if (show_if_17) {
    				if (if_block0) {
    					if_block0.p(ctx, dirty);
    				} else {
    					if_block0 = create_if_block_17(ctx);
    					if_block0.c();
    					if_block0.m(ul0, t5);
    				}
    			} else if (if_block0) {
    				if_block0.d(1);
    				if_block0 = null;
    			}

    			if (dirty & /*addr*/ 1) show_if_16 = !isEmpty(/*profile*/ ctx[10].links.linkedin);

    			if (show_if_16) {
    				if (if_block1) {
    					if_block1.p(ctx, dirty);
    				} else {
    					if_block1 = create_if_block_16(ctx);
    					if_block1.c();
    					if_block1.m(ul0, t6);
    				}
    			} else if (if_block1) {
    				if_block1.d(1);
    				if_block1 = null;
    			}

    			if (dirty & /*addr*/ 1) show_if_15 = !isEmpty(/*profile*/ ctx[10].links.github);

    			if (show_if_15) {
    				if (if_block2) {
    					if_block2.p(ctx, dirty);
    				} else {
    					if_block2 = create_if_block_15(ctx);
    					if_block2.c();
    					if_block2.m(ul0, t7);
    				}
    			} else if (if_block2) {
    				if_block2.d(1);
    				if_block2 = null;
    			}

    			if (dirty & /*addr*/ 1) show_if_14 = !isEmpty(/*profile*/ ctx[10].links.discord);

    			if (show_if_14) {
    				if (if_block3) {
    					if_block3.p(ctx, dirty);
    				} else {
    					if_block3 = create_if_block_14(ctx);
    					if_block3.c();
    					if_block3.m(ul0, t8);
    				}
    			} else if (if_block3) {
    				if_block3.d(1);
    				if_block3 = null;
    			}

    			if (dirty & /*addr*/ 1) show_if_13 = !isEmpty(/*profile*/ ctx[10].owner);

    			if (show_if_13) {
    				if (if_block4) {
    					if_block4.p(ctx, dirty);
    				} else {
    					if_block4 = create_if_block_13(ctx);
    					if_block4.c();
    					if_block4.m(ul0, t9);
    				}
    			} else if (if_block4) {
    				if_block4.d(1);
    				if_block4 = null;
    			}

    			if (dirty & /*addr*/ 1) show_if_12 = !isEmpty(/*profile*/ ctx[10].links.twitch);

    			if (show_if_12) {
    				if (if_block5) {
    					if_block5.p(ctx, dirty);
    				} else {
    					if_block5 = create_if_block_12(ctx);
    					if_block5.c();
    					if_block5.m(ul0, t10);
    				}
    			} else if (if_block5) {
    				if_block5.d(1);
    				if_block5 = null;
    			}

    			if (dirty & /*addr*/ 1) show_if_11 = !isEmpty(/*profile*/ ctx[10].links.instagram);

    			if (show_if_11) {
    				if (if_block6) {
    					if_block6.p(ctx, dirty);
    				} else {
    					if_block6 = create_if_block_11(ctx);
    					if_block6.c();
    					if_block6.m(ul0, t11);
    				}
    			} else if (if_block6) {
    				if_block6.d(1);
    				if_block6 = null;
    			}

    			if (dirty & /*addr*/ 1) show_if_10 = !isEmpty(/*profile*/ ctx[10].links.youtube);

    			if (show_if_10) {
    				if (if_block7) {
    					if_block7.p(ctx, dirty);
    				} else {
    					if_block7 = create_if_block_10(ctx);
    					if_block7.c();
    					if_block7.m(ul0, t12);
    				}
    			} else if (if_block7) {
    				if_block7.d(1);
    				if_block7 = null;
    			}

    			if (dirty & /*addr*/ 1) show_if_9 = !isEmpty(/*profile*/ ctx[10].links.twitter);

    			if (show_if_9) {
    				if (if_block8) {
    					if_block8.p(ctx, dirty);
    				} else {
    					if_block8 = create_if_block_9(ctx);
    					if_block8.c();
    					if_block8.m(ul0, null);
    				}
    			} else if (if_block8) {
    				if_block8.d(1);
    				if_block8 = null;
    			}

    			if (!current || dirty & /*addr*/ 1 && div1_class_value !== (div1_class_value = "bg-[url('" + (/*profile*/ ctx[10].background || /*defaultBackground*/ ctx[3]) + "')] bg-cover bg-no-repeat w-full h-[100px] mb-[10px]")) {
    				attr(div1, "class", div1_class_value);
    			}

    			if (dirty & /*addr*/ 1) show_if_8 = !isEmpty(/*profile*/ ctx[10].links.facebook);

    			if (show_if_8) {
    				if (if_block9) {
    					if_block9.p(ctx, dirty);
    				} else {
    					if_block9 = create_if_block_8(ctx);
    					if_block9.c();
    					if_block9.m(ul1, t14);
    				}
    			} else if (if_block9) {
    				if_block9.d(1);
    				if_block9 = null;
    			}

    			if (dirty & /*addr*/ 1) show_if_7 = !isEmpty(/*profile*/ ctx[10].links.linkedin);

    			if (show_if_7) {
    				if (if_block10) {
    					if_block10.p(ctx, dirty);
    				} else {
    					if_block10 = create_if_block_7(ctx);
    					if_block10.c();
    					if_block10.m(ul1, t15);
    				}
    			} else if (if_block10) {
    				if_block10.d(1);
    				if_block10 = null;
    			}

    			if (dirty & /*addr*/ 1) show_if_6 = !isEmpty(/*profile*/ ctx[10].links.github);

    			if (show_if_6) {
    				if (if_block11) {
    					if_block11.p(ctx, dirty);
    				} else {
    					if_block11 = create_if_block_6(ctx);
    					if_block11.c();
    					if_block11.m(ul1, t16);
    				}
    			} else if (if_block11) {
    				if_block11.d(1);
    				if_block11 = null;
    			}

    			if (dirty & /*addr*/ 1) show_if_5 = !isEmpty(/*profile*/ ctx[10].links.discord);

    			if (show_if_5) {
    				if (if_block12) {
    					if_block12.p(ctx, dirty);
    				} else {
    					if_block12 = create_if_block_5(ctx);
    					if_block12.c();
    					if_block12.m(ul1, t17);
    				}
    			} else if (if_block12) {
    				if_block12.d(1);
    				if_block12 = null;
    			}

    			if (dirty & /*addr*/ 1) show_if_4 = !isEmpty(/*profile*/ ctx[10].owner);

    			if (show_if_4) {
    				if (if_block13) {
    					if_block13.p(ctx, dirty);
    				} else {
    					if_block13 = create_if_block_4(ctx);
    					if_block13.c();
    					if_block13.m(ul1, t18);
    				}
    			} else if (if_block13) {
    				if_block13.d(1);
    				if_block13 = null;
    			}

    			if (dirty & /*addr*/ 1) show_if_3 = !isEmpty(/*profile*/ ctx[10].links.twitch);

    			if (show_if_3) {
    				if (if_block14) {
    					if_block14.p(ctx, dirty);
    				} else {
    					if_block14 = create_if_block_3(ctx);
    					if_block14.c();
    					if_block14.m(ul1, t19);
    				}
    			} else if (if_block14) {
    				if_block14.d(1);
    				if_block14 = null;
    			}

    			if (dirty & /*addr*/ 1) show_if_2 = !isEmpty(/*profile*/ ctx[10].links.instagram);

    			if (show_if_2) {
    				if (if_block15) {
    					if_block15.p(ctx, dirty);
    				} else {
    					if_block15 = create_if_block_2(ctx);
    					if_block15.c();
    					if_block15.m(ul1, t20);
    				}
    			} else if (if_block15) {
    				if_block15.d(1);
    				if_block15 = null;
    			}

    			if (dirty & /*addr*/ 1) show_if_1 = !isEmpty(/*profile*/ ctx[10].links.youtube);

    			if (show_if_1) {
    				if (if_block16) {
    					if_block16.p(ctx, dirty);
    				} else {
    					if_block16 = create_if_block_1(ctx);
    					if_block16.c();
    					if_block16.m(ul1, t21);
    				}
    			} else if (if_block16) {
    				if_block16.d(1);
    				if_block16 = null;
    			}

    			if (dirty & /*addr*/ 1) show_if = !isEmpty(/*profile*/ ctx[10].links.twitter);

    			if (show_if) {
    				if (if_block17) {
    					if_block17.p(ctx, dirty);
    				} else {
    					if_block17 = create_if_block(ctx);
    					if_block17.c();
    					if_block17.m(ul1, null);
    				}
    			} else if (if_block17) {
    				if_block17.d(1);
    				if_block17 = null;
    			}

    			if (!current || dirty & /*addr*/ 1 && !src_url_equal(img1.src, img1_src_value = /*profile*/ ctx[10].avatar || /*defaultAvatar*/ ctx[4])) {
    				attr(img1, "src", img1_src_value);
    			}

    			if ((!current || dirty & /*addr*/ 1) && t24_value !== (t24_value = /*profile*/ ctx[10].name + "")) set_data(t24, t24_value);
    			if ((!current || dirty & /*addr*/ 1) && t26_value !== (t26_value = /*profile*/ ctx[10].bio + "")) set_data(t26, t26_value);

    			if (!current || dirty & /*addr*/ 1 && div6_class_value !== (div6_class_value = "bg-[url('" + (/*profile*/ ctx[10].background || /*defaultBackground*/ ctx[3]) + "')] bg-cover bg-no-repeat w-full h-[300px] mb-[50px]")) {
    				attr(div6, "class", div6_class_value);
    			}

    			const modal_changes = {};
    			if (dirty & /*mailDialog*/ 2) modal_changes.open = /*mailDialog*/ ctx[1];

    			if (dirty & /*$$scope, addr, mailDialog, sending*/ 4103) {
    				modal_changes.$$scope = { dirty, ctx };
    			}

    			modal.$set(modal_changes);
    		},
    		i(local) {
    			if (current) return;
    			transition_in(modal.$$.fragment, local);
    			current = true;
    		},
    		o(local) {
    			transition_out(modal.$$.fragment, local);
    			current = false;
    		},
    		d(detaching) {
    			if (detaching) detach(div2);
    			if (if_block0) if_block0.d();
    			if (if_block1) if_block1.d();
    			if (if_block2) if_block2.d();
    			if (if_block3) if_block3.d();
    			if (if_block4) if_block4.d();
    			if (if_block5) if_block5.d();
    			if (if_block6) if_block6.d();
    			if (if_block7) if_block7.d();
    			if (if_block8) if_block8.d();
    			if (detaching) detach(t13);
    			if (detaching) detach(div7);
    			if (if_block9) if_block9.d();
    			if (if_block10) if_block10.d();
    			if (if_block11) if_block11.d();
    			if (if_block12) if_block12.d();
    			if (if_block13) if_block13.d();
    			if (if_block14) if_block14.d();
    			if (if_block15) if_block15.d();
    			if (if_block16) if_block16.d();
    			if (if_block17) if_block17.d();
    			if (detaching) detach(t27);
    			destroy_component(modal, detaching);
    		}
    	};
    }

    // (57:8) {#if !isEmpty(profile.links.facebook)}
    function create_if_block_17(ctx) {
    	let li;
    	let a;
    	let button;
    	let a_href_value;

    	return {
    		c() {
    			li = element("li");
    			a = element("a");
    			button = element("button");
    			set_style(button, "background-image", "url(" + icon_repo + "/facebook-icon.png)");
    			attr(button, "class", "w-[32px] h-[32px] rounded-xl bg-cover bg-no-repeat");
    			attr(a, "href", a_href_value = "https://facebook.com/" + /*profile*/ ctx[10].links.facebook);
    			attr(a, "target", "_blank");
    			attr(a, "rel", "noreferrer");
    		},
    		m(target, anchor) {
    			insert(target, li, anchor);
    			append(li, a);
    			append(a, button);
    		},
    		p(ctx, dirty) {
    			if (dirty & /*addr*/ 1 && a_href_value !== (a_href_value = "https://facebook.com/" + /*profile*/ ctx[10].links.facebook)) {
    				attr(a, "href", a_href_value);
    			}
    		},
    		d(detaching) {
    			if (detaching) detach(li);
    		}
    	};
    }

    // (73:8) {#if !isEmpty(profile.links.linkedin)}
    function create_if_block_16(ctx) {
    	let li;
    	let a;
    	let button;
    	let a_href_value;

    	return {
    		c() {
    			li = element("li");
    			a = element("a");
    			button = element("button");
    			set_style(button, "background-image", "url(" + icon_repo + "/linkedin-icon.png)");
    			attr(button, "class", "w-[32px] h-[32px] rounded-xl bg-cover bg-no-repeat");
    			attr(a, "href", a_href_value = "https://www.linkedin.com/in/" + /*profile*/ ctx[10].links.linkedin);
    			attr(a, "target", "_blank");
    			attr(a, "rel", "noreferrer");
    		},
    		m(target, anchor) {
    			insert(target, li, anchor);
    			append(li, a);
    			append(a, button);
    		},
    		p(ctx, dirty) {
    			if (dirty & /*addr*/ 1 && a_href_value !== (a_href_value = "https://www.linkedin.com/in/" + /*profile*/ ctx[10].links.linkedin)) {
    				attr(a, "href", a_href_value);
    			}
    		},
    		d(detaching) {
    			if (detaching) detach(li);
    		}
    	};
    }

    // (89:8) {#if !isEmpty(profile.links.github)}
    function create_if_block_15(ctx) {
    	let li;
    	let a;
    	let button;
    	let a_href_value;

    	return {
    		c() {
    			li = element("li");
    			a = element("a");
    			button = element("button");
    			set_style(button, "background-image", "url(" + icon_repo + "/github-icon.png)");
    			attr(button, "class", "w-[32px] h-[32px] rounded-xl bg-cover bg-no-repeat");
    			attr(a, "href", a_href_value = "https://github.com/" + /*profile*/ ctx[10].links.github);
    			attr(a, "target", "_blank");
    			attr(a, "rel", "noreferrer");
    		},
    		m(target, anchor) {
    			insert(target, li, anchor);
    			append(li, a);
    			append(a, button);
    		},
    		p(ctx, dirty) {
    			if (dirty & /*addr*/ 1 && a_href_value !== (a_href_value = "https://github.com/" + /*profile*/ ctx[10].links.github)) {
    				attr(a, "href", a_href_value);
    			}
    		},
    		d(detaching) {
    			if (detaching) detach(li);
    		}
    	};
    }

    // (105:8) {#if !isEmpty(profile.links.discord)}
    function create_if_block_14(ctx) {
    	let li;
    	let a;
    	let button;
    	let a_href_value;

    	return {
    		c() {
    			li = element("li");
    			a = element("a");
    			button = element("button");
    			set_style(button, "background-image", "url(" + icon_repo + "/discord-icon.png)");
    			attr(button, "class", "w-[32px] h-[32px] rounded-xl bg-cover bg-no-repeat");
    			attr(a, "href", a_href_value = "https://discord.com/users/" + /*profile*/ ctx[10].links.discord);
    			attr(a, "target", "_blank");
    			attr(a, "rel", "noreferrer");
    		},
    		m(target, anchor) {
    			insert(target, li, anchor);
    			append(li, a);
    			append(a, button);
    		},
    		p(ctx, dirty) {
    			if (dirty & /*addr*/ 1 && a_href_value !== (a_href_value = "https://discord.com/users/" + /*profile*/ ctx[10].links.discord)) {
    				attr(a, "href", a_href_value);
    			}
    		},
    		d(detaching) {
    			if (detaching) detach(li);
    		}
    	};
    }

    // (121:8) {#if !isEmpty(profile.owner)}
    function create_if_block_13(ctx) {
    	let li;
    	let button;
    	let mounted;
    	let dispose;

    	return {
    		c() {
    			li = element("li");
    			button = element("button");
    			set_style(button, "background-image", "url(" + icon_repo + "/arweave-mail-icon.png)");
    			attr(button, "class", "w-[32px] h-[32px] rounded-xl bg-cover bg-no-repeat");
    		},
    		m(target, anchor) {
    			insert(target, li, anchor);
    			append(li, button);

    			if (!mounted) {
    				dispose = listen(button, "click", /*click_handler*/ ctx[5]);
    				mounted = true;
    			}
    		},
    		p: noop,
    		d(detaching) {
    			if (detaching) detach(li);
    			mounted = false;
    			dispose();
    		}
    	};
    }

    // (132:8) {#if !isEmpty(profile.links.twitch)}
    function create_if_block_12(ctx) {
    	let li;
    	let a;
    	let button;
    	let a_href_value;

    	return {
    		c() {
    			li = element("li");
    			a = element("a");
    			button = element("button");
    			set_style(button, "background-image", "url(" + icon_repo + "/twitch-icon.png)");
    			attr(button, "class", "w-[32px] h-[32px] rounded-xl bg-cover bg-no-repeat");
    			attr(a, "href", a_href_value = "https://twitch.com/" + /*profile*/ ctx[10].links.twitch);
    			attr(a, "target", "_blank");
    			attr(a, "rel", "noreferrer");
    		},
    		m(target, anchor) {
    			insert(target, li, anchor);
    			append(li, a);
    			append(a, button);
    		},
    		p(ctx, dirty) {
    			if (dirty & /*addr*/ 1 && a_href_value !== (a_href_value = "https://twitch.com/" + /*profile*/ ctx[10].links.twitch)) {
    				attr(a, "href", a_href_value);
    			}
    		},
    		d(detaching) {
    			if (detaching) detach(li);
    		}
    	};
    }

    // (148:8) {#if !isEmpty(profile.links.instagram)}
    function create_if_block_11(ctx) {
    	let li;
    	let a;
    	let button;
    	let a_href_value;

    	return {
    		c() {
    			li = element("li");
    			a = element("a");
    			button = element("button");
    			set_style(button, "background-image", "url(" + icon_repo + "/instagram-icon.png)");
    			attr(button, "class", "w-[32px] h-[32px] rounded-xl bg-cover bg-no-repeat");
    			attr(a, "href", a_href_value = "https://instagram.com/" + /*profile*/ ctx[10].links.instagram);
    			attr(a, "target", "_blank");
    			attr(a, "rel", "noreferrer");
    		},
    		m(target, anchor) {
    			insert(target, li, anchor);
    			append(li, a);
    			append(a, button);
    		},
    		p(ctx, dirty) {
    			if (dirty & /*addr*/ 1 && a_href_value !== (a_href_value = "https://instagram.com/" + /*profile*/ ctx[10].links.instagram)) {
    				attr(a, "href", a_href_value);
    			}
    		},
    		d(detaching) {
    			if (detaching) detach(li);
    		}
    	};
    }

    // (164:8) {#if !isEmpty(profile.links.youtube)}
    function create_if_block_10(ctx) {
    	let li;
    	let a;
    	let button;
    	let a_href_value;

    	return {
    		c() {
    			li = element("li");
    			a = element("a");
    			button = element("button");
    			set_style(button, "background-image", "url(" + icon_repo + "/youtube-icon.png)");
    			attr(button, "class", "w-[32px] h-[32px] rounded-xl bg-cover bg-no-repeat");
    			attr(a, "href", a_href_value = "https://youtube.com/c/" + /*profile*/ ctx[10].links.youtube);
    			attr(a, "target", "_blank");
    			attr(a, "rel", "noreferrer");
    		},
    		m(target, anchor) {
    			insert(target, li, anchor);
    			append(li, a);
    			append(a, button);
    		},
    		p(ctx, dirty) {
    			if (dirty & /*addr*/ 1 && a_href_value !== (a_href_value = "https://youtube.com/c/" + /*profile*/ ctx[10].links.youtube)) {
    				attr(a, "href", a_href_value);
    			}
    		},
    		d(detaching) {
    			if (detaching) detach(li);
    		}
    	};
    }

    // (180:8) {#if !isEmpty(profile.links.twitter)}
    function create_if_block_9(ctx) {
    	let li;
    	let a;
    	let button;
    	let a_href_value;

    	return {
    		c() {
    			li = element("li");
    			a = element("a");
    			button = element("button");
    			set_style(button, "background-image", "url(" + icon_repo + "/twitter-icon.png)");
    			attr(button, "class", "w-[32px] h-[32px] rounded-xl bg-cover bg-no-repeat");
    			attr(a, "href", a_href_value = "https://twitter.com/" + /*profile*/ ctx[10].links.twitter);
    			attr(a, "target", "_blank");
    			attr(a, "rel", "noreferrer");
    		},
    		m(target, anchor) {
    			insert(target, li, anchor);
    			append(li, a);
    			append(a, button);
    		},
    		p(ctx, dirty) {
    			if (dirty & /*addr*/ 1 && a_href_value !== (a_href_value = "https://twitter.com/" + /*profile*/ ctx[10].links.twitter)) {
    				attr(a, "href", a_href_value);
    			}
    		},
    		d(detaching) {
    			if (detaching) detach(li);
    		}
    	};
    }

    // (206:10) {#if !isEmpty(profile.links.facebook)}
    function create_if_block_8(ctx) {
    	let li;
    	let a;
    	let button;
    	let a_href_value;

    	return {
    		c() {
    			li = element("li");
    			a = element("a");
    			button = element("button");
    			set_style(button, "background-image", "url(" + icon_repo + "/facebook-icon.png)");
    			attr(button, "class", "w-[94px] h-[94px] m-5 rounded-xl bg-cover bg-no-repeat");
    			attr(a, "href", a_href_value = "https://facebook.com/" + /*profile*/ ctx[10].links.facebook);
    			attr(a, "target", "_blank");
    			attr(a, "rel", "noreferrer");
    		},
    		m(target, anchor) {
    			insert(target, li, anchor);
    			append(li, a);
    			append(a, button);
    		},
    		p(ctx, dirty) {
    			if (dirty & /*addr*/ 1 && a_href_value !== (a_href_value = "https://facebook.com/" + /*profile*/ ctx[10].links.facebook)) {
    				attr(a, "href", a_href_value);
    			}
    		},
    		d(detaching) {
    			if (detaching) detach(li);
    		}
    	};
    }

    // (222:10) {#if !isEmpty(profile.links.linkedin)}
    function create_if_block_7(ctx) {
    	let li;
    	let a;
    	let button;
    	let a_href_value;

    	return {
    		c() {
    			li = element("li");
    			a = element("a");
    			button = element("button");
    			set_style(button, "background-image", "url(" + icon_repo + "/linkedin-icon.png)");
    			attr(button, "class", "w-[94px] h-[94px] m-5 rounded-xl bg-cover bg-no-repeat");
    			attr(a, "href", a_href_value = "https://www.linkedin.com/in/" + /*profile*/ ctx[10].links.linkedin);
    			attr(a, "target", "_blank");
    			attr(a, "rel", "noreferrer");
    		},
    		m(target, anchor) {
    			insert(target, li, anchor);
    			append(li, a);
    			append(a, button);
    		},
    		p(ctx, dirty) {
    			if (dirty & /*addr*/ 1 && a_href_value !== (a_href_value = "https://www.linkedin.com/in/" + /*profile*/ ctx[10].links.linkedin)) {
    				attr(a, "href", a_href_value);
    			}
    		},
    		d(detaching) {
    			if (detaching) detach(li);
    		}
    	};
    }

    // (238:10) {#if !isEmpty(profile.links.github)}
    function create_if_block_6(ctx) {
    	let li;
    	let a;
    	let button;
    	let a_href_value;

    	return {
    		c() {
    			li = element("li");
    			a = element("a");
    			button = element("button");
    			set_style(button, "background-image", "url(" + icon_repo + "/github-icon.png)");
    			attr(button, "class", "w-[94px] h-[94px] m-5 rounded-xl bg-cover bg-no-repeat");
    			attr(a, "href", a_href_value = "https://github.com/" + /*profile*/ ctx[10].links.github);
    			attr(a, "target", "_blank");
    			attr(a, "rel", "noreferrer");
    		},
    		m(target, anchor) {
    			insert(target, li, anchor);
    			append(li, a);
    			append(a, button);
    		},
    		p(ctx, dirty) {
    			if (dirty & /*addr*/ 1 && a_href_value !== (a_href_value = "https://github.com/" + /*profile*/ ctx[10].links.github)) {
    				attr(a, "href", a_href_value);
    			}
    		},
    		d(detaching) {
    			if (detaching) detach(li);
    		}
    	};
    }

    // (254:10) {#if !isEmpty(profile.links.discord)}
    function create_if_block_5(ctx) {
    	let li;
    	let a;
    	let button;
    	let a_href_value;

    	return {
    		c() {
    			li = element("li");
    			a = element("a");
    			button = element("button");
    			set_style(button, "background-image", "url(" + icon_repo + "/discord-icon.png)");
    			attr(button, "class", "w-[94px] h-[94px] m-5 rounded-xl bg-cover bg-no-repeat");
    			attr(a, "href", a_href_value = "https://discord.com/users/" + /*profile*/ ctx[10].links.discord);
    			attr(a, "target", "_blank");
    			attr(a, "rel", "noreferrer");
    		},
    		m(target, anchor) {
    			insert(target, li, anchor);
    			append(li, a);
    			append(a, button);
    		},
    		p(ctx, dirty) {
    			if (dirty & /*addr*/ 1 && a_href_value !== (a_href_value = "https://discord.com/users/" + /*profile*/ ctx[10].links.discord)) {
    				attr(a, "href", a_href_value);
    			}
    		},
    		d(detaching) {
    			if (detaching) detach(li);
    		}
    	};
    }

    // (270:10) {#if !isEmpty(profile.owner)}
    function create_if_block_4(ctx) {
    	let li;
    	let button;
    	let mounted;
    	let dispose;

    	return {
    		c() {
    			li = element("li");
    			button = element("button");
    			set_style(button, "background-image", "url(" + icon_repo + "/arweave-mail-icon.png)");
    			attr(button, "class", "w-[94px] h-[94px] m-5 rounded-xl bg-cover bg-no-repeat");
    		},
    		m(target, anchor) {
    			insert(target, li, anchor);
    			append(li, button);

    			if (!mounted) {
    				dispose = listen(button, "click", /*click_handler_1*/ ctx[6]);
    				mounted = true;
    			}
    		},
    		p: noop,
    		d(detaching) {
    			if (detaching) detach(li);
    			mounted = false;
    			dispose();
    		}
    	};
    }

    // (281:10) {#if !isEmpty(profile.links.twitch)}
    function create_if_block_3(ctx) {
    	let li;
    	let a;
    	let button;
    	let a_href_value;

    	return {
    		c() {
    			li = element("li");
    			a = element("a");
    			button = element("button");
    			set_style(button, "background-image", "url(" + icon_repo + "/twitch-icon.png)");
    			attr(button, "class", "w-[94px] h-[94px] m-5 rounded-xl bg-cover bg-no-repeat");
    			attr(a, "href", a_href_value = "https://twitch.com/" + /*profile*/ ctx[10].links.twitch);
    			attr(a, "target", "_blank");
    			attr(a, "rel", "noreferrer");
    		},
    		m(target, anchor) {
    			insert(target, li, anchor);
    			append(li, a);
    			append(a, button);
    		},
    		p(ctx, dirty) {
    			if (dirty & /*addr*/ 1 && a_href_value !== (a_href_value = "https://twitch.com/" + /*profile*/ ctx[10].links.twitch)) {
    				attr(a, "href", a_href_value);
    			}
    		},
    		d(detaching) {
    			if (detaching) detach(li);
    		}
    	};
    }

    // (297:10) {#if !isEmpty(profile.links.instagram)}
    function create_if_block_2(ctx) {
    	let li;
    	let a;
    	let button;
    	let a_href_value;

    	return {
    		c() {
    			li = element("li");
    			a = element("a");
    			button = element("button");
    			set_style(button, "background-image", "url(" + icon_repo + "/instagram-icon.png)");
    			attr(button, "class", "w-[94px] h-[94px] m-5 rounded-xl bg-cover bg-no-repeat");
    			attr(a, "href", a_href_value = "https://instagram.com/" + /*profile*/ ctx[10].links.instagram);
    			attr(a, "target", "_blank");
    			attr(a, "rel", "noreferrer");
    		},
    		m(target, anchor) {
    			insert(target, li, anchor);
    			append(li, a);
    			append(a, button);
    		},
    		p(ctx, dirty) {
    			if (dirty & /*addr*/ 1 && a_href_value !== (a_href_value = "https://instagram.com/" + /*profile*/ ctx[10].links.instagram)) {
    				attr(a, "href", a_href_value);
    			}
    		},
    		d(detaching) {
    			if (detaching) detach(li);
    		}
    	};
    }

    // (313:10) {#if !isEmpty(profile.links.youtube)}
    function create_if_block_1(ctx) {
    	let li;
    	let a;
    	let button;
    	let a_href_value;

    	return {
    		c() {
    			li = element("li");
    			a = element("a");
    			button = element("button");
    			set_style(button, "background-image", "url(" + icon_repo + "/youtube-icon.png)");
    			attr(button, "class", "w-[94px] h-[94px] m-5 rounded-xl bg-cover bg-no-repeat");
    			attr(a, "href", a_href_value = "https://youtube.com/c/" + /*profile*/ ctx[10].links.youtube);
    			attr(a, "target", "_blank");
    			attr(a, "rel", "noreferrer");
    		},
    		m(target, anchor) {
    			insert(target, li, anchor);
    			append(li, a);
    			append(a, button);
    		},
    		p(ctx, dirty) {
    			if (dirty & /*addr*/ 1 && a_href_value !== (a_href_value = "https://youtube.com/c/" + /*profile*/ ctx[10].links.youtube)) {
    				attr(a, "href", a_href_value);
    			}
    		},
    		d(detaching) {
    			if (detaching) detach(li);
    		}
    	};
    }

    // (329:10) {#if !isEmpty(profile.links.twitter)}
    function create_if_block(ctx) {
    	let li;
    	let a;
    	let button;
    	let a_href_value;

    	return {
    		c() {
    			li = element("li");
    			a = element("a");
    			button = element("button");
    			set_style(button, "background-image", "url(" + icon_repo + "/twitter-icon.png)");
    			attr(button, "class", "w-[94px] h-[94px] m-5 rounded-xl bg-cover bg-no-repeat");
    			attr(a, "href", a_href_value = "https://twitter.com/" + /*profile*/ ctx[10].links.twitter);
    			attr(a, "target", "_blank");
    			attr(a, "rel", "noreferrer");
    		},
    		m(target, anchor) {
    			insert(target, li, anchor);
    			append(li, a);
    			append(a, button);
    		},
    		p(ctx, dirty) {
    			if (dirty & /*addr*/ 1 && a_href_value !== (a_href_value = "https://twitter.com/" + /*profile*/ ctx[10].links.twitter)) {
    				attr(a, "href", a_href_value);
    			}
    		},
    		d(detaching) {
    			if (detaching) detach(li);
    		}
    	};
    }

    // (362:2) <Modal open={mailDialog} ok={false}>
    function create_default_slot_1(ctx) {
    	let h3;
    	let t0;
    	let t1_value = /*profile*/ ctx[10].name + "";
    	let t1;
    	let t2;
    	let mailform;
    	let current;

    	mailform = new Mailform({
    			props: { address: /*profile*/ ctx[10].owner }
    		});

    	mailform.$on("sending", /*sending_handler*/ ctx[7]);
    	mailform.$on("mail", /*mail_handler*/ ctx[8]);
    	mailform.$on("cancel", /*cancel_handler*/ ctx[9]);

    	return {
    		c() {
    			h3 = element("h3");
    			t0 = text("Message/Tip ");
    			t1 = text(t1_value);
    			t2 = space();
    			create_component(mailform.$$.fragment);
    			attr(h3, "class", "text-2xl text-secondary");
    		},
    		m(target, anchor) {
    			insert(target, h3, anchor);
    			append(h3, t0);
    			append(h3, t1);
    			insert(target, t2, anchor);
    			mount_component(mailform, target, anchor);
    			current = true;
    		},
    		p(ctx, dirty) {
    			if ((!current || dirty & /*addr*/ 1) && t1_value !== (t1_value = /*profile*/ ctx[10].name + "")) set_data(t1, t1_value);
    			const mailform_changes = {};
    			if (dirty & /*addr*/ 1) mailform_changes.address = /*profile*/ ctx[10].owner;
    			mailform.$set(mailform_changes);
    		},
    		i(local) {
    			if (current) return;
    			transition_in(mailform.$$.fragment, local);
    			current = true;
    		},
    		o(local) {
    			transition_out(mailform.$$.fragment, local);
    			current = false;
    		},
    		d(detaching) {
    			if (detaching) detach(h3);
    			if (detaching) detach(t2);
    			destroy_component(mailform, detaching);
    		}
    	};
    }

    // (1:0) <script>   import Modal from "./components/modal.svelte";   import Mailform from "./components/mailform.svelte";   import { getProfile }
    function create_pending_block(ctx) {
    	return {
    		c: noop,
    		m: noop,
    		p: noop,
    		i: noop,
    		o: noop,
    		d: noop
    	};
    }

    // (384:0) <Modal open={sending} ok={false}>
    function create_default_slot(ctx) {
    	let h3;

    	return {
    		c() {
    			h3 = element("h3");
    			h3.textContent = "Sending message...";
    			attr(h3, "class", "text-2xl text-secondary");
    		},
    		m(target, anchor) {
    			insert(target, h3, anchor);
    		},
    		p: noop,
    		d(detaching) {
    			if (detaching) detach(h3);
    		}
    	};
    }

    function create_fragment(ctx) {
    	let promise;
    	let t;
    	let modal;
    	let current;

    	let info = {
    		ctx,
    		current: null,
    		token: null,
    		hasCatch: true,
    		pending: create_pending_block,
    		then: create_then_block,
    		catch: create_catch_block,
    		value: 10,
    		error: 11,
    		blocks: [,,,]
    	};

    	handle_promise(promise = getProfile(/*addr*/ ctx[0]), info);

    	modal = new Modal({
    			props: {
    				open: /*sending*/ ctx[2],
    				ok: false,
    				$$slots: { default: [create_default_slot] },
    				$$scope: { ctx }
    			}
    		});

    	return {
    		c() {
    			info.block.c();
    			t = space();
    			create_component(modal.$$.fragment);
    		},
    		m(target, anchor) {
    			info.block.m(target, info.anchor = anchor);
    			info.mount = () => t.parentNode;
    			info.anchor = t;
    			insert(target, t, anchor);
    			mount_component(modal, target, anchor);
    			current = true;
    		},
    		p(new_ctx, [dirty]) {
    			ctx = new_ctx;
    			info.ctx = ctx;

    			if (dirty & /*addr*/ 1 && promise !== (promise = getProfile(/*addr*/ ctx[0])) && handle_promise(promise, info)) ; else {
    				update_await_block_branch(info, ctx, dirty);
    			}

    			const modal_changes = {};
    			if (dirty & /*sending*/ 4) modal_changes.open = /*sending*/ ctx[2];

    			if (dirty & /*$$scope*/ 4096) {
    				modal_changes.$$scope = { dirty, ctx };
    			}

    			modal.$set(modal_changes);
    		},
    		i(local) {
    			if (current) return;
    			transition_in(info.block);
    			transition_in(modal.$$.fragment, local);
    			current = true;
    		},
    		o(local) {
    			for (let i = 0; i < 3; i += 1) {
    				const block = info.blocks[i];
    				transition_out(block);
    			}

    			transition_out(modal.$$.fragment, local);
    			current = false;
    		},
    		d(detaching) {
    			info.block.d(detaching);
    			info.token = null;
    			info = null;
    			if (detaching) detach(t);
    			destroy_component(modal, detaching);
    		}
    	};
    }

    let icon_repo = "https://arweave.net/T2Kh2uOv3myw8L6BPE6kySs2QXjh8R3B1KolcW_MFQA";

    //let backgroundUrl = background ? background : icon_repo + "/background.svg";
    //let avatarUrl = avatar ? avatar : icon_repo + "/avatar.svg";
    function isEmpty(v) {
    	if (!v) {
    		return true;
    	}

    	return v?.length === 0 ? true : false;
    }

    function instance($$self, $$props, $$invalidate) {
    	let { addr = "" } = $$props;

    	//let icon_repo = "https://social-icons.arweave.dev";
    	let mailDialog = false;

    	let sending = false;
    	const defaultBackground = icon_repo + "/background.svg";
    	const defaultAvatar = icon_repo + "/avatar.svg";
    	const click_handler = () => $$invalidate(1, mailDialog = true);
    	const click_handler_1 = () => $$invalidate(1, mailDialog = true);

    	const sending_handler = () => {
    		$$invalidate(1, mailDialog = false);
    		$$invalidate(2, sending = true);
    	};

    	const mail_handler = () => {
    		$$invalidate(1, mailDialog = false);
    		$$invalidate(2, sending = false);
    	};

    	const cancel_handler = () => {
    		$$invalidate(1, mailDialog = false);
    		$$invalidate(2, sending = false);
    	};

    	$$self.$$set = $$props => {
    		if ('addr' in $$props) $$invalidate(0, addr = $$props.addr);
    	};

    	return [
    		addr,
    		mailDialog,
    		sending,
    		defaultBackground,
    		defaultAvatar,
    		click_handler,
    		click_handler_1,
    		sending_handler,
    		mail_handler,
    		cancel_handler
    	];
    }

    class Widget extends SvelteComponent {
    	constructor(options) {
    		super();
    		init(this, options, instance, create_fragment, safe_not_equal, { addr: 0 });
    	}
    }

    const el = document.getElementById('profile');
    const dataset = el.dataset;

    new Widget({
      target: el,
      props: dataset
    });

})();

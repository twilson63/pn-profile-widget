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

    function _arity$4(n, fn) {
      /* eslint-disable no-unused-vars */
      switch (n) {
        case 0:
          return function () {
            return fn.apply(this, arguments);
          };

        case 1:
          return function (a0) {
            return fn.apply(this, arguments);
          };

        case 2:
          return function (a0, a1) {
            return fn.apply(this, arguments);
          };

        case 3:
          return function (a0, a1, a2) {
            return fn.apply(this, arguments);
          };

        case 4:
          return function (a0, a1, a2, a3) {
            return fn.apply(this, arguments);
          };

        case 5:
          return function (a0, a1, a2, a3, a4) {
            return fn.apply(this, arguments);
          };

        case 6:
          return function (a0, a1, a2, a3, a4, a5) {
            return fn.apply(this, arguments);
          };

        case 7:
          return function (a0, a1, a2, a3, a4, a5, a6) {
            return fn.apply(this, arguments);
          };

        case 8:
          return function (a0, a1, a2, a3, a4, a5, a6, a7) {
            return fn.apply(this, arguments);
          };

        case 9:
          return function (a0, a1, a2, a3, a4, a5, a6, a7, a8) {
            return fn.apply(this, arguments);
          };

        case 10:
          return function (a0, a1, a2, a3, a4, a5, a6, a7, a8, a9) {
            return fn.apply(this, arguments);
          };

        default:
          throw new Error('First argument to _arity must be a non-negative integer no greater than ten');
      }
    }

    var _arity_1 = _arity$4;

    function _pipe$1(f, g) {
      return function () {
        return g.call(this, f.apply(this, arguments));
      };
    }

    var _pipe_1 = _pipe$1;

    function _isPlaceholder$4(a) {
      return a != null && typeof a === 'object' && a['@@functional/placeholder'] === true;
    }

    var _isPlaceholder_1 = _isPlaceholder$4;

    var _isPlaceholder$3 =

    _isPlaceholder_1;
    /**
     * Optimized internal one-arity curry function.
     *
     * @private
     * @category Function
     * @param {Function} fn The function to curry.
     * @return {Function} The curried function.
     */


    function _curry1$8(fn) {
      return function f1(a) {
        if (arguments.length === 0 || _isPlaceholder$3(a)) {
          return f1;
        } else {
          return fn.apply(this, arguments);
        }
      };
    }

    var _curry1_1 = _curry1$8;

    var _curry1$7 =

    _curry1_1;

    var _isPlaceholder$2 =

    _isPlaceholder_1;
    /**
     * Optimized internal two-arity curry function.
     *
     * @private
     * @category Function
     * @param {Function} fn The function to curry.
     * @return {Function} The curried function.
     */


    function _curry2$b(fn) {
      return function f2(a, b) {
        switch (arguments.length) {
          case 0:
            return f2;

          case 1:
            return _isPlaceholder$2(a) ? f2 : _curry1$7(function (_b) {
              return fn(a, _b);
            });

          default:
            return _isPlaceholder$2(a) && _isPlaceholder$2(b) ? f2 : _isPlaceholder$2(a) ? _curry1$7(function (_a) {
              return fn(_a, b);
            }) : _isPlaceholder$2(b) ? _curry1$7(function (_b) {
              return fn(a, _b);
            }) : fn(a, b);
        }
      };
    }

    var _curry2_1 = _curry2$b;

    var _curry1$6 =

    _curry1_1;

    var _curry2$a =

    _curry2_1;

    var _isPlaceholder$1 =

    _isPlaceholder_1;
    /**
     * Optimized internal three-arity curry function.
     *
     * @private
     * @category Function
     * @param {Function} fn The function to curry.
     * @return {Function} The curried function.
     */


    function _curry3$3(fn) {
      return function f3(a, b, c) {
        switch (arguments.length) {
          case 0:
            return f3;

          case 1:
            return _isPlaceholder$1(a) ? f3 : _curry2$a(function (_b, _c) {
              return fn(a, _b, _c);
            });

          case 2:
            return _isPlaceholder$1(a) && _isPlaceholder$1(b) ? f3 : _isPlaceholder$1(a) ? _curry2$a(function (_a, _c) {
              return fn(_a, b, _c);
            }) : _isPlaceholder$1(b) ? _curry2$a(function (_b, _c) {
              return fn(a, _b, _c);
            }) : _curry1$6(function (_c) {
              return fn(a, b, _c);
            });

          default:
            return _isPlaceholder$1(a) && _isPlaceholder$1(b) && _isPlaceholder$1(c) ? f3 : _isPlaceholder$1(a) && _isPlaceholder$1(b) ? _curry2$a(function (_a, _b) {
              return fn(_a, _b, c);
            }) : _isPlaceholder$1(a) && _isPlaceholder$1(c) ? _curry2$a(function (_a, _c) {
              return fn(_a, b, _c);
            }) : _isPlaceholder$1(b) && _isPlaceholder$1(c) ? _curry2$a(function (_b, _c) {
              return fn(a, _b, _c);
            }) : _isPlaceholder$1(a) ? _curry1$6(function (_a) {
              return fn(_a, b, c);
            }) : _isPlaceholder$1(b) ? _curry1$6(function (_b) {
              return fn(a, _b, c);
            }) : _isPlaceholder$1(c) ? _curry1$6(function (_c) {
              return fn(a, b, _c);
            }) : fn(a, b, c);
        }
      };
    }

    var _curry3_1 = _curry3$3;

    /**
     * Tests whether or not an object is an array.
     *
     * @private
     * @param {*} val The object to test.
     * @return {Boolean} `true` if `val` is an array, `false` otherwise.
     * @example
     *
     *      _isArray([]); //=> true
     *      _isArray(null); //=> false
     *      _isArray({}); //=> false
     */

    var _isArray$3 = Array.isArray || function _isArray(val) {
      return val != null && val.length >= 0 && Object.prototype.toString.call(val) === '[object Array]';
    };

    function _isString$3(x) {
      return Object.prototype.toString.call(x) === '[object String]';
    }

    var _isString_1 = _isString$3;

    var _curry1$5 =

    _curry1_1;

    var _isArray$2 =

    _isArray$3;

    var _isString$2 =

    _isString_1;
    /**
     * Tests whether or not an object is similar to an array.
     *
     * @private
     * @category Type
     * @category List
     * @sig * -> Boolean
     * @param {*} x The object to test.
     * @return {Boolean} `true` if `x` has a numeric length property and extreme indices defined; `false` otherwise.
     * @example
     *
     *      _isArrayLike([]); //=> true
     *      _isArrayLike(true); //=> false
     *      _isArrayLike({}); //=> false
     *      _isArrayLike({length: 10}); //=> false
     *      _isArrayLike({0: 'zero', 9: 'nine', length: 10}); //=> true
     *      _isArrayLike({nodeType: 1, length: 1}) // => false
     */


    var _isArrayLike$1 =
    /*#__PURE__*/
    _curry1$5(function isArrayLike(x) {
      if (_isArray$2(x)) {
        return true;
      }

      if (!x) {
        return false;
      }

      if (typeof x !== 'object') {
        return false;
      }

      if (_isString$2(x)) {
        return false;
      }

      if (x.length === 0) {
        return true;
      }

      if (x.length > 0) {
        return x.hasOwnProperty(0) && x.hasOwnProperty(x.length - 1);
      }

      return false;
    });

    var _isArrayLike_1 = _isArrayLike$1;

    var XWrap =
    /*#__PURE__*/
    function () {
      function XWrap(fn) {
        this.f = fn;
      }

      XWrap.prototype['@@transducer/init'] = function () {
        throw new Error('init not implemented on XWrap');
      };

      XWrap.prototype['@@transducer/result'] = function (acc) {
        return acc;
      };

      XWrap.prototype['@@transducer/step'] = function (acc, x) {
        return this.f(acc, x);
      };

      return XWrap;
    }();

    function _xwrap$1(fn) {
      return new XWrap(fn);
    }

    var _xwrap_1 = _xwrap$1;

    var _arity$3 =

    _arity_1;

    var _curry2$9 =

    _curry2_1;
    /**
     * Creates a function that is bound to a context.
     * Note: `R.bind` does not provide the additional argument-binding capabilities of
     * [Function.prototype.bind](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Function/bind).
     *
     * @func
     * @memberOf R
     * @since v0.6.0
     * @category Function
     * @category Object
     * @sig (* -> *) -> {*} -> (* -> *)
     * @param {Function} fn The function to bind to context
     * @param {Object} thisObj The context to bind `fn` to
     * @return {Function} A function that will execute in the context of `thisObj`.
     * @see R.partial
     * @example
     *
     *      const log = R.bind(console.log, console);
     *      R.pipe(R.assoc('a', 2), R.tap(log), R.assoc('a', 3))({a: 1}); //=> {a: 3}
     *      // logs {a: 2}
     * @symb R.bind(f, o)(a, b) = f.call(o, a, b)
     */


    var bind$1 =
    /*#__PURE__*/
    _curry2$9(function bind(fn, thisObj) {
      return _arity$3(fn.length, function () {
        return fn.apply(thisObj, arguments);
      });
    });

    var bind_1 = bind$1;

    var _isArrayLike =

    _isArrayLike_1;

    var _xwrap =

    _xwrap_1;

    var bind =

    bind_1;

    function _arrayReduce(xf, acc, list) {
      var idx = 0;
      var len = list.length;

      while (idx < len) {
        acc = xf['@@transducer/step'](acc, list[idx]);

        if (acc && acc['@@transducer/reduced']) {
          acc = acc['@@transducer/value'];
          break;
        }

        idx += 1;
      }

      return xf['@@transducer/result'](acc);
    }

    function _iterableReduce(xf, acc, iter) {
      var step = iter.next();

      while (!step.done) {
        acc = xf['@@transducer/step'](acc, step.value);

        if (acc && acc['@@transducer/reduced']) {
          acc = acc['@@transducer/value'];
          break;
        }

        step = iter.next();
      }

      return xf['@@transducer/result'](acc);
    }

    function _methodReduce(xf, acc, obj, methodName) {
      return xf['@@transducer/result'](obj[methodName](bind(xf['@@transducer/step'], xf), acc));
    }

    var symIterator = typeof Symbol !== 'undefined' ? Symbol.iterator : '@@iterator';

    function _reduce$2(fn, acc, list) {
      if (typeof fn === 'function') {
        fn = _xwrap(fn);
      }

      if (_isArrayLike(list)) {
        return _arrayReduce(fn, acc, list);
      }

      if (typeof list['fantasy-land/reduce'] === 'function') {
        return _methodReduce(fn, acc, list, 'fantasy-land/reduce');
      }

      if (list[symIterator] != null) {
        return _iterableReduce(fn, acc, list[symIterator]());
      }

      if (typeof list.next === 'function') {
        return _iterableReduce(fn, acc, list);
      }

      if (typeof list.reduce === 'function') {
        return _methodReduce(fn, acc, list, 'reduce');
      }

      throw new TypeError('reduce: list must be array or iterable');
    }

    var _reduce_1 = _reduce$2;

    var _curry3$2 =

    _curry3_1;

    var _reduce$1 =

    _reduce_1;
    /**
     * Returns a single item by iterating through the list, successively calling
     * the iterator function and passing it an accumulator value and the current
     * value from the array, and then passing the result to the next call.
     *
     * The iterator function receives two values: *(acc, value)*. It may use
     * [`R.reduced`](#reduced) to shortcut the iteration.
     *
     * The arguments' order of [`reduceRight`](#reduceRight)'s iterator function
     * is *(value, acc)*.
     *
     * Note: `R.reduce` does not skip deleted or unassigned indices (sparse
     * arrays), unlike the native `Array.prototype.reduce` method. For more details
     * on this behavior, see:
     * https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Array/reduce#Description
     *
     * Dispatches to the `reduce` method of the third argument, if present. When
     * doing so, it is up to the user to handle the [`R.reduced`](#reduced)
     * shortcuting, as this is not implemented by `reduce`.
     *
     * @func
     * @memberOf R
     * @since v0.1.0
     * @category List
     * @sig ((a, b) -> a) -> a -> [b] -> a
     * @param {Function} fn The iterator function. Receives two values, the accumulator and the
     *        current element from the array.
     * @param {*} acc The accumulator value.
     * @param {Array} list The list to iterate over.
     * @return {*} The final, accumulated value.
     * @see R.reduced, R.addIndex, R.reduceRight
     * @example
     *
     *      R.reduce(R.subtract, 0, [1, 2, 3, 4]) // => ((((0 - 1) - 2) - 3) - 4) = -10
     *      //          -               -10
     *      //         / \              / \
     *      //        -   4           -6   4
     *      //       / \              / \
     *      //      -   3   ==>     -3   3
     *      //     / \              / \
     *      //    -   2           -1   2
     *      //   / \              / \
     *      //  0   1            0   1
     *
     * @symb R.reduce(f, a, [b, c, d]) = f(f(f(a, b), c), d)
     */


    var reduce$1 =
    /*#__PURE__*/
    _curry3$2(_reduce$1);

    var reduce_1 = reduce$1;

    var _isArray$1 =

    _isArray$3;
    /**
     * This checks whether a function has a [methodname] function. If it isn't an
     * array it will execute that function otherwise it will default to the ramda
     * implementation.
     *
     * @private
     * @param {Function} fn ramda implementation
     * @param {String} methodname property to check for a custom implementation
     * @return {Object} Whatever the return value of the method is.
     */


    function _checkForMethod$2(methodname, fn) {
      return function () {
        var length = arguments.length;

        if (length === 0) {
          return fn();
        }

        var obj = arguments[length - 1];
        return _isArray$1(obj) || typeof obj[methodname] !== 'function' ? fn.apply(this, arguments) : obj[methodname].apply(obj, Array.prototype.slice.call(arguments, 0, length - 1));
      };
    }

    var _checkForMethod_1 = _checkForMethod$2;

    var _checkForMethod$1 =

    _checkForMethod_1;

    var _curry3$1 =

    _curry3_1;
    /**
     * Returns the elements of the given list or string (or object with a `slice`
     * method) from `fromIndex` (inclusive) to `toIndex` (exclusive).
     *
     * Dispatches to the `slice` method of the third argument, if present.
     *
     * @func
     * @memberOf R
     * @since v0.1.4
     * @category List
     * @sig Number -> Number -> [a] -> [a]
     * @sig Number -> Number -> String -> String
     * @param {Number} fromIndex The start index (inclusive).
     * @param {Number} toIndex The end index (exclusive).
     * @param {*} list
     * @return {*}
     * @example
     *
     *      R.slice(1, 3, ['a', 'b', 'c', 'd']);        //=> ['b', 'c']
     *      R.slice(1, Infinity, ['a', 'b', 'c', 'd']); //=> ['b', 'c', 'd']
     *      R.slice(0, -1, ['a', 'b', 'c', 'd']);       //=> ['a', 'b', 'c']
     *      R.slice(-3, -1, ['a', 'b', 'c', 'd']);      //=> ['b', 'c']
     *      R.slice(0, 3, 'ramda');                     //=> 'ram'
     */


    var slice$1 =
    /*#__PURE__*/
    _curry3$1(
    /*#__PURE__*/
    _checkForMethod$1('slice', function slice(fromIndex, toIndex, list) {
      return Array.prototype.slice.call(list, fromIndex, toIndex);
    }));

    var slice_1 = slice$1;

    var _checkForMethod =

    _checkForMethod_1;

    var _curry1$4 =

    _curry1_1;

    var slice =

    slice_1;
    /**
     * Returns all but the first element of the given list or string (or object
     * with a `tail` method).
     *
     * Dispatches to the `slice` method of the first argument, if present.
     *
     * @func
     * @memberOf R
     * @since v0.1.0
     * @category List
     * @sig [a] -> [a]
     * @sig String -> String
     * @param {*} list
     * @return {*}
     * @see R.head, R.init, R.last
     * @example
     *
     *      R.tail([1, 2, 3]);  //=> [2, 3]
     *      R.tail([1, 2]);     //=> [2]
     *      R.tail([1]);        //=> []
     *      R.tail([]);         //=> []
     *
     *      R.tail('abc');  //=> 'bc'
     *      R.tail('ab');   //=> 'b'
     *      R.tail('a');    //=> ''
     *      R.tail('');     //=> ''
     */


    var tail$1 =
    /*#__PURE__*/
    _curry1$4(
    /*#__PURE__*/
    _checkForMethod('tail',
    /*#__PURE__*/
    slice(1, Infinity)));

    var tail_1 = tail$1;

    var _arity$2 =

    _arity_1;

    var _pipe =

    _pipe_1;

    var reduce =

    reduce_1;

    var tail =

    tail_1;
    /**
     * Performs left-to-right function composition. The first argument may have
     * any arity; the remaining arguments must be unary.
     *
     * In some libraries this function is named `sequence`.
     *
     * **Note:** The result of pipe is not automatically curried.
     *
     * @func
     * @memberOf R
     * @since v0.1.0
     * @category Function
     * @sig (((a, b, ..., n) -> o), (o -> p), ..., (x -> y), (y -> z)) -> ((a, b, ..., n) -> z)
     * @param {...Function} functions
     * @return {Function}
     * @see R.compose
     * @example
     *
     *      const f = R.pipe(Math.pow, R.negate, R.inc);
     *
     *      f(3, 4); // -(3^4) + 1
     * @symb R.pipe(f, g, h)(a, b) = h(g(f(a, b)))
     * @symb R.pipe(f, g, h)(a)(b) = h(g(f(a)))(b)
     */


    function pipe$1() {
      if (arguments.length === 0) {
        throw new Error('pipe requires at least one argument');
      }

      return _arity$2(arguments[0].length, reduce(_pipe, arguments[0], tail(arguments)));
    }

    var pipe_1 = pipe$1;

    var _curry1$3 =

    _curry1_1;

    var _isString$1 =

    _isString_1;
    /**
     * Returns a new list or string with the elements or characters in reverse
     * order.
     *
     * @func
     * @memberOf R
     * @since v0.1.0
     * @category List
     * @sig [a] -> [a]
     * @sig String -> String
     * @param {Array|String} list
     * @return {Array|String}
     * @example
     *
     *      R.reverse([1, 2, 3]);  //=> [3, 2, 1]
     *      R.reverse([1, 2]);     //=> [2, 1]
     *      R.reverse([1]);        //=> [1]
     *      R.reverse([]);         //=> []
     *
     *      R.reverse('abc');      //=> 'cba'
     *      R.reverse('ab');       //=> 'ba'
     *      R.reverse('a');        //=> 'a'
     *      R.reverse('');         //=> ''
     */


    var reverse$1 =
    /*#__PURE__*/
    _curry1$3(function reverse(list) {
      return _isString$1(list) ? list.split('').reverse().join('') : Array.prototype.slice.call(list, 0).reverse();
    });

    var reverse_1 = reverse$1;

    var pipe =

    pipe_1;

    var reverse =

    reverse_1;
    /**
     * Performs right-to-left function composition. The last argument may have
     * any arity; the remaining arguments must be unary.
     *
     * **Note:** The result of compose is not automatically curried.
     *
     * @func
     * @memberOf R
     * @since v0.1.0
     * @category Function
     * @sig ((y -> z), (x -> y), ..., (o -> p), ((a, b, ..., n) -> o)) -> ((a, b, ..., n) -> z)
     * @param {...Function} ...functions The functions to compose
     * @return {Function}
     * @see R.pipe
     * @example
     *
     *      const classyGreeting = (firstName, lastName) => "The name's " + lastName + ", " + firstName + " " + lastName
     *      const yellGreeting = R.compose(R.toUpper, classyGreeting);
     *      yellGreeting('James', 'Bond'); //=> "THE NAME'S BOND, JAMES BOND"
     *
     *      R.compose(Math.abs, R.add(1), R.multiply(2))(-4) //=> 7
     *
     * @symb R.compose(f, g, h)(a, b) = f(g(h(a, b)))
     * @symb R.compose(f, g, h)(a)(b) = f(g(h(a)))(b)
     */


    function compose() {
      if (arguments.length === 0) {
        throw new Error('compose requires at least one argument');
      }

      return pipe.apply(this, reverse(arguments));
    }

    var compose_1 = compose;

    var _curry2$8 =

    _curry2_1;
    /**
     * Sorts the list according to the supplied function.
     *
     * @func
     * @memberOf R
     * @since v0.1.0
     * @category Relation
     * @sig Ord b => (a -> b) -> [a] -> [a]
     * @param {Function} fn
     * @param {Array} list The list to sort.
     * @return {Array} A new list sorted by the keys generated by `fn`.
     * @example
     *
     *      const sortByFirstItem = R.sortBy(R.prop(0));
     *      const pairs = [[-1, 1], [-2, 2], [-3, 3]];
     *      sortByFirstItem(pairs); //=> [[-3, 3], [-2, 2], [-1, 1]]
     *
     *      const sortByNameCaseInsensitive = R.sortBy(R.compose(R.toLower, R.prop('name')));
     *      const alice = {
     *        name: 'ALICE',
     *        age: 101
     *      };
     *      const bob = {
     *        name: 'Bob',
     *        age: -10
     *      };
     *      const clara = {
     *        name: 'clara',
     *        age: 314.159
     *      };
     *      const people = [clara, bob, alice];
     *      sortByNameCaseInsensitive(people); //=> [alice, bob, clara]
     */


    var sortBy =
    /*#__PURE__*/
    _curry2$8(function sortBy(fn, list) {
      return Array.prototype.slice.call(list, 0).sort(function (a, b) {
        var aa = fn(a);
        var bb = fn(b);
        return aa < bb ? -1 : aa > bb ? 1 : 0;
      });
    });

    var sortBy_1 = sortBy;

    /**
     * Determine if the passed argument is an integer.
     *
     * @private
     * @param {*} n
     * @category Type
     * @return {Boolean}
     */

    var _isInteger$1 = Number.isInteger || function _isInteger(n) {
      return n << 0 === n;
    };

    var _curry2$7 =

    _curry2_1;

    var _isString =

    _isString_1;
    /**
     * Returns the nth element of the given list or string. If n is negative the
     * element at index length + n is returned.
     *
     * @func
     * @memberOf R
     * @since v0.1.0
     * @category List
     * @sig Number -> [a] -> a | Undefined
     * @sig Number -> String -> String
     * @param {Number} offset
     * @param {*} list
     * @return {*}
     * @example
     *
     *      const list = ['foo', 'bar', 'baz', 'quux'];
     *      R.nth(1, list); //=> 'bar'
     *      R.nth(-1, list); //=> 'quux'
     *      R.nth(-99, list); //=> undefined
     *
     *      R.nth(2, 'abc'); //=> 'c'
     *      R.nth(3, 'abc'); //=> ''
     * @symb R.nth(-1, [a, b, c]) = c
     * @symb R.nth(0, [a, b, c]) = a
     * @symb R.nth(1, [a, b, c]) = b
     */


    var nth$2 =
    /*#__PURE__*/
    _curry2$7(function nth(offset, list) {
      var idx = offset < 0 ? list.length + offset : offset;
      return _isString(list) ? list.charAt(idx) : list[idx];
    });

    var nth_1 = nth$2;

    var _curry2$6 =

    _curry2_1;

    var _isInteger =

    _isInteger$1;

    var nth$1 =

    nth_1;
    /**
     * Returns a function that when supplied an object returns the indicated
     * property of that object, if it exists.
     *
     * @func
     * @memberOf R
     * @since v0.1.0
     * @category Object
     * @typedefn Idx = String | Int | Symbol
     * @sig Idx -> {s: a} -> a | Undefined
     * @param {String|Number} p The property name or array index
     * @param {Object} obj The object to query
     * @return {*} The value at `obj.p`.
     * @see R.path, R.props, R.pluck, R.project, R.nth
     * @example
     *
     *      R.prop('x', {x: 100}); //=> 100
     *      R.prop('x', {}); //=> undefined
     *      R.prop(0, [100]); //=> 100
     *      R.compose(R.inc, R.prop('x'))({ x: 3 }) //=> 4
     */


    var prop$1 =
    /*#__PURE__*/
    _curry2$6(function prop(p, obj) {
      if (obj == null) {
        return;
      }

      return _isInteger(p) ? nth$1(p, obj) : obj[p];
    });

    var prop_1 = prop$1;

    var nth =

    nth_1;
    /**
     * Returns the first element of the given list or string. In some libraries
     * this function is named `first`.
     *
     * @func
     * @memberOf R
     * @since v0.1.0
     * @category List
     * @sig [a] -> a | Undefined
     * @sig String -> String
     * @param {Array|String} list
     * @return {*}
     * @see R.tail, R.init, R.last
     * @example
     *
     *      R.head(['fi', 'fo', 'fum']); //=> 'fi'
     *      R.head([]); //=> undefined
     *
     *      R.head('abc'); //=> 'a'
     *      R.head(''); //=> ''
     */


    var head =
    /*#__PURE__*/
    nth(0);
    var head_1 = head;

    function _arrayFromIterator$1(iter) {
      var list = [];
      var next;

      while (!(next = iter.next()).done) {
        list.push(next.value);
      }

      return list;
    }

    var _arrayFromIterator_1 = _arrayFromIterator$1;

    function _includesWith$1(pred, x, list) {
      var idx = 0;
      var len = list.length;

      while (idx < len) {
        if (pred(x, list[idx])) {
          return true;
        }

        idx += 1;
      }

      return false;
    }

    var _includesWith_1 = _includesWith$1;

    function _functionName$1(f) {
      // String(x => x) evaluates to "x => x", so the pattern may not match.
      var match = String(f).match(/^function (\w*)/);
      return match == null ? '' : match[1];
    }

    var _functionName_1 = _functionName$1;

    function _has$3(prop, obj) {
      return Object.prototype.hasOwnProperty.call(obj, prop);
    }

    var _has_1 = _has$3;

    // Based on https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Object/is
    function _objectIs$1(a, b) {
      // SameValue algorithm
      if (a === b) {
        // Steps 1-5, 7-10
        // Steps 6.b-6.e: +0 != -0
        return a !== 0 || 1 / a === 1 / b;
      } else {
        // Step 6.a: NaN == NaN
        return a !== a && b !== b;
      }
    }

    var _objectIs_1 = typeof Object.is === 'function' ? Object.is : _objectIs$1;

    var _has$2 =

    _has_1;

    var toString = Object.prototype.toString;

    var _isArguments$1 =
    /*#__PURE__*/
    function () {
      return toString.call(arguments) === '[object Arguments]' ? function _isArguments(x) {
        return toString.call(x) === '[object Arguments]';
      } : function _isArguments(x) {
        return _has$2('callee', x);
      };
    }();

    var _isArguments_1 = _isArguments$1;

    var _curry1$2 =

    _curry1_1;

    var _has$1 =

    _has_1;

    var _isArguments =

    _isArguments_1; // cover IE < 9 keys issues


    var hasEnumBug = !
    /*#__PURE__*/
    {
      toString: null
    }.propertyIsEnumerable('toString');
    var nonEnumerableProps = ['constructor', 'valueOf', 'isPrototypeOf', 'toString', 'propertyIsEnumerable', 'hasOwnProperty', 'toLocaleString']; // Safari bug

    var hasArgsEnumBug =
    /*#__PURE__*/
    function () {

      return arguments.propertyIsEnumerable('length');
    }();

    var contains = function contains(list, item) {
      var idx = 0;

      while (idx < list.length) {
        if (list[idx] === item) {
          return true;
        }

        idx += 1;
      }

      return false;
    };
    /**
     * Returns a list containing the names of all the enumerable own properties of
     * the supplied object.
     * Note that the order of the output array is not guaranteed to be consistent
     * across different JS platforms.
     *
     * @func
     * @memberOf R
     * @since v0.1.0
     * @category Object
     * @sig {k: v} -> [k]
     * @param {Object} obj The object to extract properties from
     * @return {Array} An array of the object's own properties.
     * @see R.keysIn, R.values, R.toPairs
     * @example
     *
     *      R.keys({a: 1, b: 2, c: 3}); //=> ['a', 'b', 'c']
     */


    var keys$2 = typeof Object.keys === 'function' && !hasArgsEnumBug ?
    /*#__PURE__*/
    _curry1$2(function keys(obj) {
      return Object(obj) !== obj ? [] : Object.keys(obj);
    }) :
    /*#__PURE__*/
    _curry1$2(function keys(obj) {
      if (Object(obj) !== obj) {
        return [];
      }

      var prop, nIdx;
      var ks = [];

      var checkArgsLength = hasArgsEnumBug && _isArguments(obj);

      for (prop in obj) {
        if (_has$1(prop, obj) && (!checkArgsLength || prop !== 'length')) {
          ks[ks.length] = prop;
        }
      }

      if (hasEnumBug) {
        nIdx = nonEnumerableProps.length - 1;

        while (nIdx >= 0) {
          prop = nonEnumerableProps[nIdx];

          if (_has$1(prop, obj) && !contains(ks, prop)) {
            ks[ks.length] = prop;
          }

          nIdx -= 1;
        }
      }

      return ks;
    });
    var keys_1 = keys$2;

    var _curry1$1 =

    _curry1_1;
    /**
     * Gives a single-word string description of the (native) type of a value,
     * returning such answers as 'Object', 'Number', 'Array', or 'Null'. Does not
     * attempt to distinguish user Object types any further, reporting them all as
     * 'Object'.
     *
     * @func
     * @memberOf R
     * @since v0.8.0
     * @category Type
     * @sig (* -> {*}) -> String
     * @param {*} val The value to test
     * @return {String}
     * @example
     *
     *      R.type({}); //=> "Object"
     *      R.type(1); //=> "Number"
     *      R.type(false); //=> "Boolean"
     *      R.type('s'); //=> "String"
     *      R.type(null); //=> "Null"
     *      R.type([]); //=> "Array"
     *      R.type(/[A-z]/); //=> "RegExp"
     *      R.type(() => {}); //=> "Function"
     *      R.type(undefined); //=> "Undefined"
     */


    var type$1 =
    /*#__PURE__*/
    _curry1$1(function type(val) {
      return val === null ? 'Null' : val === undefined ? 'Undefined' : Object.prototype.toString.call(val).slice(8, -1);
    });

    var type_1 = type$1;

    var _arrayFromIterator =

    _arrayFromIterator_1;

    var _includesWith =

    _includesWith_1;

    var _functionName =

    _functionName_1;

    var _has =

    _has_1;

    var _objectIs =

    _objectIs_1;

    var keys$1 =

    keys_1;

    var type =

    type_1;
    /**
     * private _uniqContentEquals function.
     * That function is checking equality of 2 iterator contents with 2 assumptions
     * - iterators lengths are the same
     * - iterators values are unique
     *
     * false-positive result will be returned for comparison of, e.g.
     * - [1,2,3] and [1,2,3,4]
     * - [1,1,1] and [1,2,3]
     * */


    function _uniqContentEquals(aIterator, bIterator, stackA, stackB) {
      var a = _arrayFromIterator(aIterator);

      var b = _arrayFromIterator(bIterator);

      function eq(_a, _b) {
        return _equals$1(_a, _b, stackA.slice(), stackB.slice());
      } // if *a* array contains any element that is not included in *b*


      return !_includesWith(function (b, aItem) {
        return !_includesWith(eq, aItem, b);
      }, b, a);
    }

    function _equals$1(a, b, stackA, stackB) {
      if (_objectIs(a, b)) {
        return true;
      }

      var typeA = type(a);

      if (typeA !== type(b)) {
        return false;
      }

      if (typeof a['fantasy-land/equals'] === 'function' || typeof b['fantasy-land/equals'] === 'function') {
        return typeof a['fantasy-land/equals'] === 'function' && a['fantasy-land/equals'](b) && typeof b['fantasy-land/equals'] === 'function' && b['fantasy-land/equals'](a);
      }

      if (typeof a.equals === 'function' || typeof b.equals === 'function') {
        return typeof a.equals === 'function' && a.equals(b) && typeof b.equals === 'function' && b.equals(a);
      }

      switch (typeA) {
        case 'Arguments':
        case 'Array':
        case 'Object':
          if (typeof a.constructor === 'function' && _functionName(a.constructor) === 'Promise') {
            return a === b;
          }

          break;

        case 'Boolean':
        case 'Number':
        case 'String':
          if (!(typeof a === typeof b && _objectIs(a.valueOf(), b.valueOf()))) {
            return false;
          }

          break;

        case 'Date':
          if (!_objectIs(a.valueOf(), b.valueOf())) {
            return false;
          }

          break;

        case 'Error':
          return a.name === b.name && a.message === b.message;

        case 'RegExp':
          if (!(a.source === b.source && a.global === b.global && a.ignoreCase === b.ignoreCase && a.multiline === b.multiline && a.sticky === b.sticky && a.unicode === b.unicode)) {
            return false;
          }

          break;
      }

      var idx = stackA.length - 1;

      while (idx >= 0) {
        if (stackA[idx] === a) {
          return stackB[idx] === b;
        }

        idx -= 1;
      }

      switch (typeA) {
        case 'Map':
          if (a.size !== b.size) {
            return false;
          }

          return _uniqContentEquals(a.entries(), b.entries(), stackA.concat([a]), stackB.concat([b]));

        case 'Set':
          if (a.size !== b.size) {
            return false;
          }

          return _uniqContentEquals(a.values(), b.values(), stackA.concat([a]), stackB.concat([b]));

        case 'Arguments':
        case 'Array':
        case 'Object':
        case 'Boolean':
        case 'Number':
        case 'String':
        case 'Date':
        case 'Error':
        case 'RegExp':
        case 'Int8Array':
        case 'Uint8Array':
        case 'Uint8ClampedArray':
        case 'Int16Array':
        case 'Uint16Array':
        case 'Int32Array':
        case 'Uint32Array':
        case 'Float32Array':
        case 'Float64Array':
        case 'ArrayBuffer':
          break;

        default:
          // Values of other types are only equal if identical.
          return false;
      }

      var keysA = keys$1(a);

      if (keysA.length !== keys$1(b).length) {
        return false;
      }

      var extendedStackA = stackA.concat([a]);
      var extendedStackB = stackB.concat([b]);
      idx = keysA.length - 1;

      while (idx >= 0) {
        var key = keysA[idx];

        if (!(_has(key, b) && _equals$1(b[key], a[key], extendedStackA, extendedStackB))) {
          return false;
        }

        idx -= 1;
      }

      return true;
    }

    var _equals_1 = _equals$1;

    var _curry2$5 =

    _curry2_1;

    var _equals =

    _equals_1;
    /**
     * Returns `true` if its arguments are equivalent, `false` otherwise. Handles
     * cyclical data structures.
     *
     * Dispatches symmetrically to the `equals` methods of both arguments, if
     * present.
     *
     * @func
     * @memberOf R
     * @since v0.15.0
     * @category Relation
     * @sig a -> b -> Boolean
     * @param {*} a
     * @param {*} b
     * @return {Boolean}
     * @example
     *
     *      R.equals(1, 1); //=> true
     *      R.equals(1, '1'); //=> false
     *      R.equals([1, 2, 3], [1, 2, 3]); //=> true
     *
     *      const a = {}; a.v = a;
     *      const b = {}; b.v = b;
     *      R.equals(a, b); //=> true
     */


    var equals$1 =
    /*#__PURE__*/
    _curry2$5(function equals(a, b) {
      return _equals(a, b, [], []);
    });

    var equals_1 = equals$1;

    var _curry3 =

    _curry3_1;

    var prop =

    prop_1;

    var equals =

    equals_1;
    /**
     * Returns `true` if the specified object property is equal, in
     * [`R.equals`](#equals) terms, to the given value; `false` otherwise.
     * You can test multiple properties with [`R.whereEq`](#whereEq).
     *
     * @func
     * @memberOf R
     * @since v0.1.0
     * @category Relation
     * @sig String -> a -> Object -> Boolean
     * @param {String} name
     * @param {*} val
     * @param {*} obj
     * @return {Boolean}
     * @see R.whereEq, R.propSatisfies, R.equals
     * @example
     *
     *      const abby = {name: 'Abby', age: 7, hair: 'blond'};
     *      const fred = {name: 'Fred', age: 12, hair: 'brown'};
     *      const rusty = {name: 'Rusty', age: 10, hair: 'brown'};
     *      const alois = {name: 'Alois', age: 15, disposition: 'surly'};
     *      const kids = [abby, fred, rusty, alois];
     *      const hasBrownHair = R.propEq('hair', 'brown');
     *      R.filter(hasBrownHair, kids); //=> [fred, rusty]
     */


    var propEq =
    /*#__PURE__*/
    _curry3(function propEq(name, val, obj) {
      return equals(val, prop(name, obj));
    });

    var propEq_1 = propEq;

    function _isTransformer$1(obj) {
      return obj != null && typeof obj['@@transducer/step'] === 'function';
    }

    var _isTransformer_1 = _isTransformer$1;

    var _isArray =

    _isArray$3;

    var _isTransformer =

    _isTransformer_1;
    /**
     * Returns a function that dispatches with different strategies based on the
     * object in list position (last argument). If it is an array, executes [fn].
     * Otherwise, if it has a function with one of the given method names, it will
     * execute that function (functor case). Otherwise, if it is a transformer,
     * uses transducer created by [transducerCreator] to return a new transformer
     * (transducer case).
     * Otherwise, it will default to executing [fn].
     *
     * @private
     * @param {Array} methodNames properties to check for a custom implementation
     * @param {Function} transducerCreator transducer factory if object is transformer
     * @param {Function} fn default ramda implementation
     * @return {Function} A function that dispatches on object in list position
     */


    function _dispatchable$2(methodNames, transducerCreator, fn) {
      return function () {
        if (arguments.length === 0) {
          return fn();
        }

        var obj = arguments[arguments.length - 1];

        if (!_isArray(obj)) {
          var idx = 0;

          while (idx < methodNames.length) {
            if (typeof obj[methodNames[idx]] === 'function') {
              return obj[methodNames[idx]].apply(obj, Array.prototype.slice.call(arguments, 0, -1));
            }

            idx += 1;
          }

          if (_isTransformer(obj)) {
            var transducer = transducerCreator.apply(null, Array.prototype.slice.call(arguments, 0, -1));
            return transducer(obj);
          }
        }

        return fn.apply(this, arguments);
      };
    }

    var _dispatchable_1 = _dispatchable$2;

    function _reduced$1(x) {
      return x && x['@@transducer/reduced'] ? x : {
        '@@transducer/value': x,
        '@@transducer/reduced': true
      };
    }

    var _reduced_1 = _reduced$1;

    var _xfBase$2 = {
      init: function () {
        return this.xf['@@transducer/init']();
      },
      result: function (result) {
        return this.xf['@@transducer/result'](result);
      }
    };

    var _curry2$4 =

    _curry2_1;

    var _reduced =

    _reduced_1;

    var _xfBase$1 =

    _xfBase$2;

    var XFind =
    /*#__PURE__*/
    function () {
      function XFind(f, xf) {
        this.xf = xf;
        this.f = f;
        this.found = false;
      }

      XFind.prototype['@@transducer/init'] = _xfBase$1.init;

      XFind.prototype['@@transducer/result'] = function (result) {
        if (!this.found) {
          result = this.xf['@@transducer/step'](result, void 0);
        }

        return this.xf['@@transducer/result'](result);
      };

      XFind.prototype['@@transducer/step'] = function (result, input) {
        if (this.f(input)) {
          this.found = true;
          result = _reduced(this.xf['@@transducer/step'](result, input));
        }

        return result;
      };

      return XFind;
    }();

    var _xfind$1 =
    /*#__PURE__*/
    _curry2$4(function _xfind(f, xf) {
      return new XFind(f, xf);
    });

    var _xfind_1 = _xfind$1;

    var _curry2$3 =

    _curry2_1;

    var _dispatchable$1 =

    _dispatchable_1;

    var _xfind =

    _xfind_1;
    /**
     * Returns the first element of the list which matches the predicate, or
     * `undefined` if no element matches.
     *
     * Dispatches to the `find` method of the second argument, if present.
     *
     * Acts as a transducer if a transformer is given in list position.
     *
     * @func
     * @memberOf R
     * @since v0.1.0
     * @category List
     * @sig (a -> Boolean) -> [a] -> a | undefined
     * @param {Function} fn The predicate function used to determine if the element is the
     *        desired one.
     * @param {Array} list The array to consider.
     * @return {Object} The element found, or `undefined`.
     * @see R.transduce
     * @example
     *
     *      const xs = [{a: 1}, {a: 2}, {a: 3}];
     *      R.find(R.propEq('a', 2))(xs); //=> {a: 2}
     *      R.find(R.propEq('a', 4))(xs); //=> undefined
     */


    var find =
    /*#__PURE__*/
    _curry2$3(
    /*#__PURE__*/
    _dispatchable$1(['find'], _xfind, function find(fn, list) {
      var idx = 0;
      var len = list.length;

      while (idx < len) {
        if (fn(list[idx])) {
          return list[idx];
        }

        idx += 1;
      }
    }));

    var find_1 = find;

    function _map$1(fn, functor) {
      var idx = 0;
      var len = functor.length;
      var result = Array(len);

      while (idx < len) {
        result[idx] = fn(functor[idx]);
        idx += 1;
      }

      return result;
    }

    var _map_1 = _map$1;

    var _curry2$2 =

    _curry2_1;

    var _xfBase =

    _xfBase$2;

    var XMap =
    /*#__PURE__*/
    function () {
      function XMap(f, xf) {
        this.xf = xf;
        this.f = f;
      }

      XMap.prototype['@@transducer/init'] = _xfBase.init;
      XMap.prototype['@@transducer/result'] = _xfBase.result;

      XMap.prototype['@@transducer/step'] = function (result, input) {
        return this.xf['@@transducer/step'](result, this.f(input));
      };

      return XMap;
    }();

    var _xmap$1 =
    /*#__PURE__*/
    _curry2$2(function _xmap(f, xf) {
      return new XMap(f, xf);
    });

    var _xmap_1 = _xmap$1;

    var _arity$1 =

    _arity_1;

    var _isPlaceholder =

    _isPlaceholder_1;
    /**
     * Internal curryN function.
     *
     * @private
     * @category Function
     * @param {Number} length The arity of the curried function.
     * @param {Array} received An array of arguments received thus far.
     * @param {Function} fn The function to curry.
     * @return {Function} The curried function.
     */


    function _curryN$1(length, received, fn) {
      return function () {
        var combined = [];
        var argsIdx = 0;
        var left = length;
        var combinedIdx = 0;

        while (combinedIdx < received.length || argsIdx < arguments.length) {
          var result;

          if (combinedIdx < received.length && (!_isPlaceholder(received[combinedIdx]) || argsIdx >= arguments.length)) {
            result = received[combinedIdx];
          } else {
            result = arguments[argsIdx];
            argsIdx += 1;
          }

          combined[combinedIdx] = result;

          if (!_isPlaceholder(result)) {
            left -= 1;
          }

          combinedIdx += 1;
        }

        return left <= 0 ? fn.apply(this, combined) : _arity$1(left, _curryN$1(length, combined, fn));
      };
    }

    var _curryN_1 = _curryN$1;

    var _arity =

    _arity_1;

    var _curry1 =

    _curry1_1;

    var _curry2$1 =

    _curry2_1;

    var _curryN =

    _curryN_1;
    /**
     * Returns a curried equivalent of the provided function, with the specified
     * arity. The curried function has two unusual capabilities. First, its
     * arguments needn't be provided one at a time. If `g` is `R.curryN(3, f)`, the
     * following are equivalent:
     *
     *   - `g(1)(2)(3)`
     *   - `g(1)(2, 3)`
     *   - `g(1, 2)(3)`
     *   - `g(1, 2, 3)`
     *
     * Secondly, the special placeholder value [`R.__`](#__) may be used to specify
     * "gaps", allowing partial application of any combination of arguments,
     * regardless of their positions. If `g` is as above and `_` is [`R.__`](#__),
     * the following are equivalent:
     *
     *   - `g(1, 2, 3)`
     *   - `g(_, 2, 3)(1)`
     *   - `g(_, _, 3)(1)(2)`
     *   - `g(_, _, 3)(1, 2)`
     *   - `g(_, 2)(1)(3)`
     *   - `g(_, 2)(1, 3)`
     *   - `g(_, 2)(_, 3)(1)`
     *
     * @func
     * @memberOf R
     * @since v0.5.0
     * @category Function
     * @sig Number -> (* -> a) -> (* -> a)
     * @param {Number} length The arity for the returned function.
     * @param {Function} fn The function to curry.
     * @return {Function} A new, curried function.
     * @see R.curry
     * @example
     *
     *      const sumArgs = (...args) => R.sum(args);
     *
     *      const curriedAddFourNumbers = R.curryN(4, sumArgs);
     *      const f = curriedAddFourNumbers(1, 2);
     *      const g = f(3);
     *      g(4); //=> 10
     */


    var curryN$1 =
    /*#__PURE__*/
    _curry2$1(function curryN(length, fn) {
      if (length === 1) {
        return _curry1(fn);
      }

      return _arity(length, _curryN(length, [], fn));
    });

    var curryN_1 = curryN$1;

    var _curry2 =

    _curry2_1;

    var _dispatchable =

    _dispatchable_1;

    var _map =

    _map_1;

    var _reduce =

    _reduce_1;

    var _xmap =

    _xmap_1;

    var curryN =

    curryN_1;

    var keys =

    keys_1;
    /**
     * Takes a function and
     * a [functor](https://github.com/fantasyland/fantasy-land#functor),
     * applies the function to each of the functor's values, and returns
     * a functor of the same shape.
     *
     * Ramda provides suitable `map` implementations for `Array` and `Object`,
     * so this function may be applied to `[1, 2, 3]` or `{x: 1, y: 2, z: 3}`.
     *
     * Dispatches to the `map` method of the second argument, if present.
     *
     * Acts as a transducer if a transformer is given in list position.
     *
     * Also treats functions as functors and will compose them together.
     *
     * @func
     * @memberOf R
     * @since v0.1.0
     * @category List
     * @sig Functor f => (a -> b) -> f a -> f b
     * @param {Function} fn The function to be called on every element of the input `list`.
     * @param {Array} list The list to be iterated over.
     * @return {Array} The new list.
     * @see R.transduce, R.addIndex, R.pluck, R.project
     * @example
     *
     *      const double = x => x * 2;
     *
     *      R.map(double, [1, 2, 3]); //=> [2, 4, 6]
     *
     *      R.map(double, {x: 1, y: 2, z: 3}); //=> {x: 2, y: 4, z: 6}
     * @symb R.map(f, [a, b]) = [f(a), f(b)]
     * @symb R.map(f, { x: a, y: b }) = { x: f(a), y: f(b) }
     * @symb R.map(f, functor_o) = functor_o.map(f)
     */


    var map =
    /*#__PURE__*/
    _curry2(
    /*#__PURE__*/
    _dispatchable(['fantasy-land/map', 'map'], _xmap, function map(fn, functor) {
      switch (Object.prototype.toString.call(functor)) {
        case '[object Function]':
          return curryN(functor.length, function () {
            return fn.call(this, functor.apply(this, arguments));
          });

        case '[object Object]':
          return _reduce(function (acc, key) {
            acc[key] = fn(functor[key]);
            return acc;
          }, {}, keys(functor));

        default:
          return _map(fn, functor);
      }
    }));

    var map_1 = map;

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
        .then(({ data: { data: { transactions: { edges } } } }) => edges.map(e => e.node))
        .then(formatNodes)
        .then(head_1)
        .then(record => arweave.api.get(record.id))
        .then(({ data }) => data)

    }


    function formatNodes(nodes) {
      return compose_1(
        reverse_1,
        sortBy_1(prop_1("timestamp")),
        map_1(txToProfile)
      )(nodes)
    }

    function getTag(name) {
      return compose_1(
        prop_1('value'),
        find_1(propEq_1('name', name))
      )
    }

    function txToProfile(tx) {
      const tsValue = getTag('Timestamp')(tx.tags);
      const timestamp = tsValue ? tsValue : new Date().toISOString();
      const page = {
        id: tx.id,
        owner: tx.owner.address,

        timestamp
      };
      return page
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

    // (25:38)    <div class="md:hidden h-[400px]">     <div       class="bg-[url('{profile.background ||         defaultBackground}
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
    	let t3_value = (/*profile*/ ctx[10].bio || "A curious traveler who likes to build neat things.") + "";
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
    	let t26_value = (/*profile*/ ctx[10].bio || "A curious traveler who likes to build neat things.") + "";
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
    			attr(div7, "class", "hidden md:block h-[450px]");
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
    			if ((!current || dirty & /*addr*/ 1) && t3_value !== (t3_value = (/*profile*/ ctx[10].bio || "A curious traveler who likes to build neat things.") + "")) set_data(t3, t3_value);
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
    			if ((!current || dirty & /*addr*/ 1) && t26_value !== (t26_value = (/*profile*/ ctx[10].bio || "A curious traveler who likes to build neat things.") + "")) set_data(t26, t26_value);

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

    // (45:8) {#if !isEmpty(profile.links.facebook)}
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

    // (61:8) {#if !isEmpty(profile.links.linkedin)}
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

    // (77:8) {#if !isEmpty(profile.links.github)}
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

    // (93:8) {#if !isEmpty(profile.links.discord)}
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

    // (109:8) {#if !isEmpty(profile.owner)}
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

    // (120:8) {#if !isEmpty(profile.links.twitch)}
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

    // (136:8) {#if !isEmpty(profile.links.instagram)}
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

    // (152:8) {#if !isEmpty(profile.links.youtube)}
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

    // (168:8) {#if !isEmpty(profile.links.twitter)}
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

    // (194:10) {#if !isEmpty(profile.links.facebook)}
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

    // (210:10) {#if !isEmpty(profile.links.linkedin)}
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

    // (226:10) {#if !isEmpty(profile.links.github)}
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

    // (242:10) {#if !isEmpty(profile.links.discord)}
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

    // (258:10) {#if !isEmpty(profile.owner)}
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

    // (269:10) {#if !isEmpty(profile.links.twitch)}
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

    // (285:10) {#if !isEmpty(profile.links.instagram)}
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

    // (301:10) {#if !isEmpty(profile.links.youtube)}
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

    // (317:10) {#if !isEmpty(profile.links.twitter)}
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

    // (353:2) <Modal open={mailDialog} ok={false}>
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

    // (375:0) <Modal open={sending} ok={false}>
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

(function () {
    'use strict';

    function noop() { }
    function assign(tar, src) {
        // @ts-ignore
        for (const k in src)
            tar[k] = src[k];
        return tar;
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
    			button0.textContent = "Send";
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

    async function generate_random_bytes(length) {
    	var array = new Uint8Array(length);
    	window.crypto.getRandomValues(array);
    	return array;
    }

    function instance$1($$self, $$props, $$invalidate) {
    	let { address = "" } = $$props;
    	const dispatch = createEventDispatcher();
    	const arweave = Arweave.init({});

    	async function send(e) {
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

    /* src/widget.svelte generated by Svelte v3.48.0 */

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
    			attr(a, "href", a_href_value = "https://facebook.com/" + /*facebook*/ ctx[5]);
    			attr(a, "target", "_blank");
    			attr(a, "rel", "noreferrer");
    		},
    		m(target, anchor) {
    			insert(target, li, anchor);
    			append(li, a);
    			append(a, button);
    		},
    		p(ctx, dirty) {
    			if (dirty & /*facebook*/ 32 && a_href_value !== (a_href_value = "https://facebook.com/" + /*facebook*/ ctx[5])) {
    				attr(a, "href", a_href_value);
    			}
    		},
    		d(detaching) {
    			if (detaching) detach(li);
    		}
    	};
    }

    // (49:8) {#if !isEmpty(linkedin)}
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
    			attr(a, "href", a_href_value = "https://www.linkedin.com/in/" + /*linkedin*/ ctx[4]);
    			attr(a, "target", "_blank");
    			attr(a, "rel", "noreferrer");
    		},
    		m(target, anchor) {
    			insert(target, li, anchor);
    			append(li, a);
    			append(a, button);
    		},
    		p(ctx, dirty) {
    			if (dirty & /*linkedin*/ 16 && a_href_value !== (a_href_value = "https://www.linkedin.com/in/" + /*linkedin*/ ctx[4])) {
    				attr(a, "href", a_href_value);
    			}
    		},
    		d(detaching) {
    			if (detaching) detach(li);
    		}
    	};
    }

    // (65:8) {#if !isEmpty(github)}
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
    			attr(a, "href", a_href_value = "https://github.com/" + /*github*/ ctx[7]);
    			attr(a, "target", "_blank");
    			attr(a, "rel", "noreferrer");
    		},
    		m(target, anchor) {
    			insert(target, li, anchor);
    			append(li, a);
    			append(a, button);
    		},
    		p(ctx, dirty) {
    			if (dirty & /*github*/ 128 && a_href_value !== (a_href_value = "https://github.com/" + /*github*/ ctx[7])) {
    				attr(a, "href", a_href_value);
    			}
    		},
    		d(detaching) {
    			if (detaching) detach(li);
    		}
    	};
    }

    // (81:8) {#if !isEmpty(discord)}
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
    			attr(a, "href", a_href_value = "https://discord.com/users/" + /*discord*/ ctx[8]);
    			attr(a, "target", "_blank");
    			attr(a, "rel", "noreferrer");
    		},
    		m(target, anchor) {
    			insert(target, li, anchor);
    			append(li, a);
    			append(a, button);
    		},
    		p(ctx, dirty) {
    			if (dirty & /*discord*/ 256 && a_href_value !== (a_href_value = "https://discord.com/users/" + /*discord*/ ctx[8])) {
    				attr(a, "href", a_href_value);
    			}
    		},
    		d(detaching) {
    			if (detaching) detach(li);
    		}
    	};
    }

    // (97:8) {#if !isEmpty(weavemail)}
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
    				dispose = listen(button, "click", /*click_handler*/ ctx[14]);
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

    // (108:8) {#if !isEmpty(twitch)}
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
    			attr(a, "href", a_href_value = "https://twitch.com/" + /*twitch*/ ctx[10]);
    			attr(a, "target", "_blank");
    			attr(a, "rel", "noreferrer");
    		},
    		m(target, anchor) {
    			insert(target, li, anchor);
    			append(li, a);
    			append(a, button);
    		},
    		p(ctx, dirty) {
    			if (dirty & /*twitch*/ 1024 && a_href_value !== (a_href_value = "https://twitch.com/" + /*twitch*/ ctx[10])) {
    				attr(a, "href", a_href_value);
    			}
    		},
    		d(detaching) {
    			if (detaching) detach(li);
    		}
    	};
    }

    // (124:8) {#if !isEmpty(instagram)}
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
    			attr(a, "href", a_href_value = "https://instagram.com/" + /*instagram*/ ctx[3]);
    			attr(a, "target", "_blank");
    			attr(a, "rel", "noreferrer");
    		},
    		m(target, anchor) {
    			insert(target, li, anchor);
    			append(li, a);
    			append(a, button);
    		},
    		p(ctx, dirty) {
    			if (dirty & /*instagram*/ 8 && a_href_value !== (a_href_value = "https://instagram.com/" + /*instagram*/ ctx[3])) {
    				attr(a, "href", a_href_value);
    			}
    		},
    		d(detaching) {
    			if (detaching) detach(li);
    		}
    	};
    }

    // (140:8) {#if !isEmpty(youtube)}
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
    			attr(a, "href", a_href_value = "https://youtube.com/c/" + /*youtube*/ ctx[9]);
    			attr(a, "target", "_blank");
    			attr(a, "rel", "noreferrer");
    		},
    		m(target, anchor) {
    			insert(target, li, anchor);
    			append(li, a);
    			append(a, button);
    		},
    		p(ctx, dirty) {
    			if (dirty & /*youtube*/ 512 && a_href_value !== (a_href_value = "https://youtube.com/c/" + /*youtube*/ ctx[9])) {
    				attr(a, "href", a_href_value);
    			}
    		},
    		d(detaching) {
    			if (detaching) detach(li);
    		}
    	};
    }

    // (156:8) {#if !isEmpty(twitter)}
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
    			attr(a, "href", a_href_value = "https://twitter.com/" + /*twitter*/ ctx[2]);
    			attr(a, "target", "_blank");
    			attr(a, "rel", "noreferrer");
    		},
    		m(target, anchor) {
    			insert(target, li, anchor);
    			append(li, a);
    			append(a, button);
    		},
    		p(ctx, dirty) {
    			if (dirty & /*twitter*/ 4 && a_href_value !== (a_href_value = "https://twitter.com/" + /*twitter*/ ctx[2])) {
    				attr(a, "href", a_href_value);
    			}
    		},
    		d(detaching) {
    			if (detaching) detach(li);
    		}
    	};
    }

    // (187:0) <Modal open={mailDialog} ok={false}>
    function create_default_slot(ctx) {
    	let h3;
    	let t0;
    	let t1;
    	let t2;
    	let mailform;
    	let current;
    	mailform = new Mailform({ props: { address: /*weavemail*/ ctx[6] } });
    	mailform.$on("mail", /*mail_handler*/ ctx[15]);
    	mailform.$on("cancel", /*cancel_handler*/ ctx[16]);

    	return {
    		c() {
    			h3 = element("h3");
    			t0 = text("Message/Tip ");
    			t1 = text(/*name*/ ctx[0]);
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
    			if (!current || dirty & /*name*/ 1) set_data(t1, /*name*/ ctx[0]);
    			const mailform_changes = {};
    			if (dirty & /*weavemail*/ 64) mailform_changes.address = /*weavemail*/ ctx[6];
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

    function create_fragment(ctx) {
    	let div4;
    	let div3;
    	let div2;
    	let ul;
    	let show_if_8 = !isEmpty(/*facebook*/ ctx[5]);
    	let t0;
    	let show_if_7 = !isEmpty(/*linkedin*/ ctx[4]);
    	let t1;
    	let show_if_6 = !isEmpty(/*github*/ ctx[7]);
    	let t2;
    	let show_if_5 = !isEmpty(/*discord*/ ctx[8]);
    	let t3;
    	let show_if_4 = !isEmpty(/*weavemail*/ ctx[6]);
    	let t4;
    	let show_if_3 = !isEmpty(/*twitch*/ ctx[10]);
    	let t5;
    	let show_if_2 = !isEmpty(/*instagram*/ ctx[3]);
    	let t6;
    	let show_if_1 = !isEmpty(/*youtube*/ ctx[9]);
    	let t7;
    	let show_if = !isEmpty(/*twitter*/ ctx[2]);
    	let t8;
    	let div1;
    	let img;
    	let img_src_value;
    	let t9;
    	let div0;
    	let p0;
    	let t10;
    	let t11;
    	let p1;
    	let t12;
    	let div3_class_value;
    	let t13;
    	let modal;
    	let current;
    	let if_block0 = show_if_8 && create_if_block_8(ctx);
    	let if_block1 = show_if_7 && create_if_block_7(ctx);
    	let if_block2 = show_if_6 && create_if_block_6(ctx);
    	let if_block3 = show_if_5 && create_if_block_5(ctx);
    	let if_block4 = show_if_4 && create_if_block_4(ctx);
    	let if_block5 = show_if_3 && create_if_block_3(ctx);
    	let if_block6 = show_if_2 && create_if_block_2(ctx);
    	let if_block7 = show_if_1 && create_if_block_1(ctx);
    	let if_block8 = show_if && create_if_block(ctx);

    	modal = new Modal({
    			props: {
    				open: /*mailDialog*/ ctx[13],
    				ok: false,
    				$$slots: { default: [create_default_slot] },
    				$$scope: { ctx }
    			}
    		});

    	return {
    		c() {
    			div4 = element("div");
    			div3 = element("div");
    			div2 = element("div");
    			ul = element("ul");
    			if (if_block0) if_block0.c();
    			t0 = space();
    			if (if_block1) if_block1.c();
    			t1 = space();
    			if (if_block2) if_block2.c();
    			t2 = space();
    			if (if_block3) if_block3.c();
    			t3 = space();
    			if (if_block4) if_block4.c();
    			t4 = space();
    			if (if_block5) if_block5.c();
    			t5 = space();
    			if (if_block6) if_block6.c();
    			t6 = space();
    			if (if_block7) if_block7.c();
    			t7 = space();
    			if (if_block8) if_block8.c();
    			t8 = space();
    			div1 = element("div");
    			img = element("img");
    			t9 = space();
    			div0 = element("div");
    			p0 = element("p");
    			t10 = text(/*name*/ ctx[0]);
    			t11 = space();
    			p1 = element("p");
    			t12 = text(/*bio*/ ctx[1]);
    			t13 = space();
    			create_component(modal.$$.fragment);
    			attr(ul, "class", "w-full flex flex-row-reverse p-5");
    			attr(img, "alt", "avatar");
    			if (!src_url_equal(img.src, img_src_value = /*avatar*/ ctx[11])) attr(img, "src", img_src_value);
    			attr(img, "class", "ml-5 mr-5 shadow-xl rounded-full border-4 max-w-[265px] bg-base-300");
    			attr(p0, "class", "m-1 text-3xl tracking-tight text-base-600");
    			attr(p1, "class", "m-1 text-xl text-base-600");
    			attr(div0, "class", "flex flex-col justify-center");
    			attr(div1, "class", "w-full flex m-5 absolute top-[565px] left-0");
    			attr(div2, "class", "w-full h-full flex flex-col justify-between relative");
    			attr(div3, "class", div3_class_value = "bg-[url('" + /*background*/ ctx[12] + "')] bg-cover bg-no-repeat w-full h-[660px] mb-[50px]");
    			attr(div4, "class", "h-[900px]");
    		},
    		m(target, anchor) {
    			insert(target, div4, anchor);
    			append(div4, div3);
    			append(div3, div2);
    			append(div2, ul);
    			if (if_block0) if_block0.m(ul, null);
    			append(ul, t0);
    			if (if_block1) if_block1.m(ul, null);
    			append(ul, t1);
    			if (if_block2) if_block2.m(ul, null);
    			append(ul, t2);
    			if (if_block3) if_block3.m(ul, null);
    			append(ul, t3);
    			if (if_block4) if_block4.m(ul, null);
    			append(ul, t4);
    			if (if_block5) if_block5.m(ul, null);
    			append(ul, t5);
    			if (if_block6) if_block6.m(ul, null);
    			append(ul, t6);
    			if (if_block7) if_block7.m(ul, null);
    			append(ul, t7);
    			if (if_block8) if_block8.m(ul, null);
    			append(div2, t8);
    			append(div2, div1);
    			append(div1, img);
    			append(div1, t9);
    			append(div1, div0);
    			append(div0, p0);
    			append(p0, t10);
    			append(div0, t11);
    			append(div0, p1);
    			append(p1, t12);
    			insert(target, t13, anchor);
    			mount_component(modal, target, anchor);
    			current = true;
    		},
    		p(ctx, [dirty]) {
    			if (dirty & /*facebook*/ 32) show_if_8 = !isEmpty(/*facebook*/ ctx[5]);

    			if (show_if_8) {
    				if (if_block0) {
    					if_block0.p(ctx, dirty);
    				} else {
    					if_block0 = create_if_block_8(ctx);
    					if_block0.c();
    					if_block0.m(ul, t0);
    				}
    			} else if (if_block0) {
    				if_block0.d(1);
    				if_block0 = null;
    			}

    			if (dirty & /*linkedin*/ 16) show_if_7 = !isEmpty(/*linkedin*/ ctx[4]);

    			if (show_if_7) {
    				if (if_block1) {
    					if_block1.p(ctx, dirty);
    				} else {
    					if_block1 = create_if_block_7(ctx);
    					if_block1.c();
    					if_block1.m(ul, t1);
    				}
    			} else if (if_block1) {
    				if_block1.d(1);
    				if_block1 = null;
    			}

    			if (dirty & /*github*/ 128) show_if_6 = !isEmpty(/*github*/ ctx[7]);

    			if (show_if_6) {
    				if (if_block2) {
    					if_block2.p(ctx, dirty);
    				} else {
    					if_block2 = create_if_block_6(ctx);
    					if_block2.c();
    					if_block2.m(ul, t2);
    				}
    			} else if (if_block2) {
    				if_block2.d(1);
    				if_block2 = null;
    			}

    			if (dirty & /*discord*/ 256) show_if_5 = !isEmpty(/*discord*/ ctx[8]);

    			if (show_if_5) {
    				if (if_block3) {
    					if_block3.p(ctx, dirty);
    				} else {
    					if_block3 = create_if_block_5(ctx);
    					if_block3.c();
    					if_block3.m(ul, t3);
    				}
    			} else if (if_block3) {
    				if_block3.d(1);
    				if_block3 = null;
    			}

    			if (dirty & /*weavemail*/ 64) show_if_4 = !isEmpty(/*weavemail*/ ctx[6]);

    			if (show_if_4) {
    				if (if_block4) {
    					if_block4.p(ctx, dirty);
    				} else {
    					if_block4 = create_if_block_4(ctx);
    					if_block4.c();
    					if_block4.m(ul, t4);
    				}
    			} else if (if_block4) {
    				if_block4.d(1);
    				if_block4 = null;
    			}

    			if (dirty & /*twitch*/ 1024) show_if_3 = !isEmpty(/*twitch*/ ctx[10]);

    			if (show_if_3) {
    				if (if_block5) {
    					if_block5.p(ctx, dirty);
    				} else {
    					if_block5 = create_if_block_3(ctx);
    					if_block5.c();
    					if_block5.m(ul, t5);
    				}
    			} else if (if_block5) {
    				if_block5.d(1);
    				if_block5 = null;
    			}

    			if (dirty & /*instagram*/ 8) show_if_2 = !isEmpty(/*instagram*/ ctx[3]);

    			if (show_if_2) {
    				if (if_block6) {
    					if_block6.p(ctx, dirty);
    				} else {
    					if_block6 = create_if_block_2(ctx);
    					if_block6.c();
    					if_block6.m(ul, t6);
    				}
    			} else if (if_block6) {
    				if_block6.d(1);
    				if_block6 = null;
    			}

    			if (dirty & /*youtube*/ 512) show_if_1 = !isEmpty(/*youtube*/ ctx[9]);

    			if (show_if_1) {
    				if (if_block7) {
    					if_block7.p(ctx, dirty);
    				} else {
    					if_block7 = create_if_block_1(ctx);
    					if_block7.c();
    					if_block7.m(ul, t7);
    				}
    			} else if (if_block7) {
    				if_block7.d(1);
    				if_block7 = null;
    			}

    			if (dirty & /*twitter*/ 4) show_if = !isEmpty(/*twitter*/ ctx[2]);

    			if (show_if) {
    				if (if_block8) {
    					if_block8.p(ctx, dirty);
    				} else {
    					if_block8 = create_if_block(ctx);
    					if_block8.c();
    					if_block8.m(ul, null);
    				}
    			} else if (if_block8) {
    				if_block8.d(1);
    				if_block8 = null;
    			}

    			if (!current || dirty & /*avatar*/ 2048 && !src_url_equal(img.src, img_src_value = /*avatar*/ ctx[11])) {
    				attr(img, "src", img_src_value);
    			}

    			if (!current || dirty & /*name*/ 1) set_data(t10, /*name*/ ctx[0]);
    			if (!current || dirty & /*bio*/ 2) set_data(t12, /*bio*/ ctx[1]);

    			if (!current || dirty & /*background*/ 4096 && div3_class_value !== (div3_class_value = "bg-[url('" + /*background*/ ctx[12] + "')] bg-cover bg-no-repeat w-full h-[660px] mb-[50px]")) {
    				attr(div3, "class", div3_class_value);
    			}

    			const modal_changes = {};
    			if (dirty & /*mailDialog*/ 8192) modal_changes.open = /*mailDialog*/ ctx[13];

    			if (dirty & /*$$scope, weavemail, mailDialog, name*/ 139329) {
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
    			if (detaching) detach(div4);
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
    			destroy_component(modal, detaching);
    		}
    	};
    }

    let icon_repo = "https://social-icons.arweave.dev";

    function isEmpty(v) {
    	return v.length === 0 ? true : false;
    }

    function instance($$self, $$props, $$invalidate) {
    	let { name = "Internet Explorer" } = $$props;
    	let { bio = "A curious traveler who likes to build neat things." } = $$props;
    	let { twitter = "" } = $$props;
    	let { instagram = "" } = $$props;
    	let { linkedin = "" } = $$props;
    	let { facebook = "" } = $$props;
    	let { weavemail = "" } = $$props;
    	let { github = "" } = $$props;
    	let { discord = "" } = $$props;
    	let { youtube = "" } = $$props;
    	let { twitch = "" } = $$props;
    	let { avatar = "" } = $$props;
    	let { background = "" } = $$props;
    	let mailDialog = false;
    	const click_handler = () => $$invalidate(13, mailDialog = true);
    	const mail_handler = () => $$invalidate(13, mailDialog = false);
    	const cancel_handler = () => $$invalidate(13, mailDialog = false);

    	$$self.$$set = $$props => {
    		if ('name' in $$props) $$invalidate(0, name = $$props.name);
    		if ('bio' in $$props) $$invalidate(1, bio = $$props.bio);
    		if ('twitter' in $$props) $$invalidate(2, twitter = $$props.twitter);
    		if ('instagram' in $$props) $$invalidate(3, instagram = $$props.instagram);
    		if ('linkedin' in $$props) $$invalidate(4, linkedin = $$props.linkedin);
    		if ('facebook' in $$props) $$invalidate(5, facebook = $$props.facebook);
    		if ('weavemail' in $$props) $$invalidate(6, weavemail = $$props.weavemail);
    		if ('github' in $$props) $$invalidate(7, github = $$props.github);
    		if ('discord' in $$props) $$invalidate(8, discord = $$props.discord);
    		if ('youtube' in $$props) $$invalidate(9, youtube = $$props.youtube);
    		if ('twitch' in $$props) $$invalidate(10, twitch = $$props.twitch);
    		if ('avatar' in $$props) $$invalidate(11, avatar = $$props.avatar);
    		if ('background' in $$props) $$invalidate(12, background = $$props.background);
    	};

    	return [
    		name,
    		bio,
    		twitter,
    		instagram,
    		linkedin,
    		facebook,
    		weavemail,
    		github,
    		discord,
    		youtube,
    		twitch,
    		avatar,
    		background,
    		mailDialog,
    		click_handler,
    		mail_handler,
    		cancel_handler
    	];
    }

    class Widget extends SvelteComponent {
    	constructor(options) {
    		super();

    		init(this, options, instance, create_fragment, safe_not_equal, {
    			name: 0,
    			bio: 1,
    			twitter: 2,
    			instagram: 3,
    			linkedin: 4,
    			facebook: 5,
    			weavemail: 6,
    			github: 7,
    			discord: 8,
    			youtube: 9,
    			twitch: 10,
    			avatar: 11,
    			background: 12
    		});
    	}
    }

    const el = document.getElementById('profile');
    const dataset = el.dataset;

    new Widget({
      target: el,
      props: dataset
    });

})();

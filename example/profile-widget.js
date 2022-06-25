(function () {
    'use strict';

    function noop() { }
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

    let current_component;
    function set_current_component(component) {
        current_component = component;
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
    function transition_in(block, local) {
        if (block && block.i) {
            outroing.delete(block);
            block.i(local);
        }
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

    // (44:6) {#if !isEmpty(linkedin)}
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

    // (60:6) {#if !isEmpty(github)}
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

    // (76:6) {#if !isEmpty(discord)}
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

    // (92:6) {#if !isEmpty(weavemail)}
    function create_if_block_4(ctx) {
    	let li;
    	let a;
    	let button;
    	let a_href_value;

    	return {
    		c() {
    			li = element("li");
    			a = element("a");
    			button = element("button");
    			set_style(button, "background-image", "url(" + icon_repo + "/arweave-mail-icon.png)");
    			attr(button, "class", "w-[94px] h-[94px] m-5 rounded-xl bg-cover bg-no-repeat");
    			attr(a, "href", a_href_value = "https://instagram.com/" + /*weavemail*/ ctx[6]);
    			attr(a, "target", "_blank");
    			attr(a, "rel", "noreferrer");
    		},
    		m(target, anchor) {
    			insert(target, li, anchor);
    			append(li, a);
    			append(a, button);
    		},
    		p(ctx, dirty) {
    			if (dirty & /*weavemail*/ 64 && a_href_value !== (a_href_value = "https://instagram.com/" + /*weavemail*/ ctx[6])) {
    				attr(a, "href", a_href_value);
    			}
    		},
    		d(detaching) {
    			if (detaching) detach(li);
    		}
    	};
    }

    // (108:6) {#if !isEmpty(twitch)}
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

    // (124:6) {#if !isEmpty(instagram)}
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

    // (140:6) {#if !isEmpty(youtube)}
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

    // (156:6) {#if !isEmpty(twitter)}
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

    function create_fragment(ctx) {
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
    	let if_block0 = show_if_8 && create_if_block_8(ctx);
    	let if_block1 = show_if_7 && create_if_block_7(ctx);
    	let if_block2 = show_if_6 && create_if_block_6(ctx);
    	let if_block3 = show_if_5 && create_if_block_5(ctx);
    	let if_block4 = show_if_4 && create_if_block_4(ctx);
    	let if_block5 = show_if_3 && create_if_block_3(ctx);
    	let if_block6 = show_if_2 && create_if_block_2(ctx);
    	let if_block7 = show_if_1 && create_if_block_1(ctx);
    	let if_block8 = show_if && create_if_block(ctx);

    	return {
    		c() {
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
    		},
    		m(target, anchor) {
    			insert(target, div3, anchor);
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

    			if (dirty & /*avatar*/ 2048 && !src_url_equal(img.src, img_src_value = /*avatar*/ ctx[11])) {
    				attr(img, "src", img_src_value);
    			}

    			if (dirty & /*name*/ 1) set_data(t10, /*name*/ ctx[0]);
    			if (dirty & /*bio*/ 2) set_data(t12, /*bio*/ ctx[1]);

    			if (dirty & /*background*/ 4096 && div3_class_value !== (div3_class_value = "bg-[url('" + /*background*/ ctx[12] + "')] bg-cover bg-no-repeat w-full h-[660px] mb-[50px]")) {
    				attr(div3, "class", div3_class_value);
    			}
    		},
    		i: noop,
    		o: noop,
    		d(detaching) {
    			if (detaching) detach(div3);
    			if (if_block0) if_block0.d();
    			if (if_block1) if_block1.d();
    			if (if_block2) if_block2.d();
    			if (if_block3) if_block3.d();
    			if (if_block4) if_block4.d();
    			if (if_block5) if_block5.d();
    			if (if_block6) if_block6.d();
    			if (if_block7) if_block7.d();
    			if (if_block8) if_block8.d();
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
    		background
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

/**
 * @fileoverview dragscroll - scroll area by dragging
 * @version 0.0.8
 *
 * @license MIT, see http://github.com/asvd/dragscroll
 * @copyright 2015 asvd <heliosframework@gmail.com>
 */

(function f(root, factory) {
  if (typeof define === 'function' && define.amd) {
    define(['exports'], factory);
  } else if (typeof exports !== 'undefined') {
    factory(exports);
  } else {
    factory((root.dragscroll = {}));
  }
}(this, (exports) => {
  const tWindow = window;
  const tDocument = document;
  const mousemove = 'mousemove';
  const mouseup = 'mouseup';
  const mousedown = 'mousedown';
  const EventListener = 'EventListener';
  const addEventListener = `add${EventListener}`;
  const removeEventListener = `remove${EventListener}`;
  let dragged = [];
  const reset = function resetFn(i, el) {
    for (i = 0; i < dragged.length;) {
      el = dragged[i++];
      el = el.container || el;
      el[removeEventListener](mousedown, el.md, 0);
      tWindow[removeEventListener](mouseup, el.mu, 0);
      tWindow[removeEventListener](mousemove, el.mm, 0);
    }

    // cloning into array since HTMLCollection is updated dynamically
    dragged = [].slice.call(tDocument.getElementsByClassName('dragscroll'));
    for (i = 0; i < dragged.length;) {
      (function dragHandler(element, lastClientX, lastClientY, pushed, scroller, cont) {
        let localScrollX;
        let localScrollY;

        (cont = element.container || element)[addEventListener](
          mousedown,
          cont.md = function mouseDownHandler(e) {
            if (!element.hasAttribute('nochilddrag')
                || tDocument.elementFromPoint(e.pageX, e.pageY) === cont) {
              pushed = 1;
              lastClientX = e.clientX;
              lastClientY = e.clientY;

              e.preventDefault();
            }
          },
          0,
        );

        tWindow[addEventListener](
          mouseup,
          cont.mu = function mouseUpHandler() {
            pushed = 0;
          },
          0,
        );

        tWindow[addEventListener](
          mousemove,
          cont.mm = function mouseMoveHandler(e) {
            if (pushed) {
              localScrollX = -lastClientX + (lastClientX = e.clientX);
              (scroller = element.scroller || element).scrollLeft -= localScrollX;
              localScrollY = -lastClientY + (lastClientY = e.clientY);
              scroller.scrollTop -= localScrollY;
              if (element === tDocument.body) {
                (scroller = tDocument.documentElement).scrollLeft -= localScrollX;
                scroller.scrollTop -= localScrollY;
              }
            }
          },
          0,
        );
      }(dragged[i++]));
    }
  };

  if (tDocument.readyState === 'complete') {
    reset();
  } else {
    tWindow[addEventListener]('load', reset, 0);
  }

  exports.reset = reset;
}));

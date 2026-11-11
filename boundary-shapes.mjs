// Boundary-condition fixtures for the shapes that external audit reviews keep
// raising against automated scanners. They join the core `static/` group, so they
// are generated, indexed and counted by build.mjs like every other core case.
//
// Rules this file follows, because the corpus depends on them:
//
//   * Every broken page has a narrowly matched negative control, and the pairs are
//     placed ON the threshold: 4.48:1 against 4.54:1, a 5s animation against a 6s
//     one, a name that contains the visible words against one that merely uses
//     them. A scanner that is right about the easy case and wrong at the boundary
//     is exactly what a corpus should expose.
//   * Pages contain invented data only. Nothing here is copied from a real site.
//   * The only defect on a page is the declared one. fixture.css supplies the
//     accessible scaffolding (contrast, target size, focus ring); pages that are
//     ABOUT one of those override it locally and nothing else.
//   * Ground truth is a statement about WCAG, not about any scanner. Shapes whose
//     verdict genuinely depends on the browser or on reviewer judgement
//     (a placeholder as the only visible label, a scroller that Chromium now makes
//     focusable by default) are deliberately absent rather than guessed.
//
// Instance counts are written into each note ("Expected instances: N") so a
// scanner that finds four of five can be told apart from one that finds five.
// catalog.json scores criteria per page; the instance count is for the reader and
// for any runner that wants to compare per element.

const mk = (expect) => (file, sc, title, note, body, extra = {}) => ({
  dir: 'static',
  file: `${expect === 'clean' ? 'safe_' : ''}${file}.html`,
  expect,
  sc,
  manual: [],
  title,
  note,
  body,
  ...extra,
});
const flag = mk('flag');
const clean = mk('clean');

const LONG = 'Each passenger may carry one cabin bag and one personal item. Larger bags are checked at the desk and charged by weight. Sports equipment, musical instruments and prams are accepted at the oversize desk only. Allow extra time for the oversize queue at peak hours.';

export const BOUNDARY_SHAPES = [
  // ───────────────── 1.4.3 contrast, on and around the 4.5:1 and 3:1 lines
  flag('text_contrast_just_below_aa', ['1.4.3'],
    'Body text at 4.48:1',
    'Boundary. #777777 on white is 4.48:1, under the 4.5:1 line for normal text. Expected instances: 1.',
    `<p style="color:#777777">Gate changes are announced here as they happen.</p>`),
  clean('text_contrast_just_above_aa', ['1.4.3'],
    'Body text at 4.54:1',
    'Negative control for text_contrast_just_below_aa.html. #767676 on white is 4.54:1, the darkest grey that still clears the line.',
    `<p style="color:#767676">Gate changes are announced here as they happen.</p>`),
  flag('text_contrast_light_on_dark_just_below', ['1.4.3'],
    'White text on a #777777 background at 4.48:1',
    'Boundary through the background rather than the text colour. Expected instances: 1.',
    `<p style="background:#777777;color:#ffffff;padding:.5rem">Boarding closes forty minutes before departure.</p>`),
  clean('text_contrast_light_on_dark_just_above', ['1.4.3'],
    'White text on a #767676 background at 4.54:1',
    'Negative control for text_contrast_light_on_dark_just_below.html.',
    `<p style="background:#767676;color:#ffffff;padding:.5rem">Boarding closes forty minutes before departure.</p>`),
  flag('text_contrast_large_just_below', ['1.4.3'],
    'Large text at 2.99:1',
    'Boundary on the large-text line. 24px text needs 3:1; #959595 on white is 2.99:1. Expected instances: 1.',
    `<p style="font-size:1.5rem;color:#959595">Fares from 49 euro</p>`),
  clean('text_contrast_large_at_threshold', ['1.4.3'],
    'Large text at 3.03:1',
    'Negative control for text_contrast_large_just_below.html. The same 24px size at #949494 (3.03:1) passes because large text only needs 3:1.',
    `<p style="font-size:1.5rem;color:#949494">Fares from 49 euro</p>`),
  flag('text_contrast_bold_below_large_size', ['1.4.3'],
    'Bold text just under the large-text size at 3.03:1',
    'Boundary on size, not colour. Bold text counts as large from 14pt (18.66px). At 18.4px it is normal text and 3.03:1 is not enough. Expected instances: 1.',
    `<p style="font-size:18.4px;font-weight:700;color:#949494">Fares from 49 euro</p>`),
  clean('text_contrast_bold_at_large_size', ['1.4.3'],
    'Bold text at the large-text size at 3.03:1',
    'Negative control for text_contrast_bold_below_large_size.html. 18.72px bold is large text, so the same colour passes.',
    `<p style="font-size:18.72px;font-weight:700;color:#949494">Fares from 49 euro</p>`),
  flag('placeholder_low_contrast', ['1.4.3'],
    'Placeholder text at 2.6:1',
    'The field has a visible label, so the only defect is the placeholder colour. #a0a0a0 on white is 2.62:1. Expected instances: 1.',
    `<style>.ph::placeholder{color:#a0a0a0;opacity:1}</style>
<label for="dest">Destination</label>
<input id="dest" class="ph" type="text" placeholder="City or airport">`),
  clean('placeholder_contrast_at_aa', ['1.4.3'],
    'Placeholder text at 4.54:1',
    'Negative control for placeholder_low_contrast.html.',
    `<style>.ph::placeholder{color:#767676;opacity:1}</style>
<label for="dest">Destination</label>
<input id="dest" class="ph" type="text" placeholder="City or airport">`),
  flag('input_value_low_contrast', ['1.4.3'],
    'Text typed into a field at 2.3:1',
    'The typed value, not the placeholder, is the low-contrast text. #aaaaaa on white is 2.32:1. Expected instances: 1.',
    `<label for="city">Departure city</label>
<input id="city" type="text" value="Lisbon" style="color:#aaaaaa">`),
  clean('input_value_contrast', ['1.4.3'],
    'Text typed into a field at 16.6:1',
    'Negative control for input_value_low_contrast.html.',
    `<label for="city">Departure city</label>
<input id="city" type="text" value="Lisbon">`),
  flag('text_contrast_effective_opacity', ['1.4.3'],
    'Text that fails only after opacity is applied',
    'The text colour #595959 is 7:1 on its own. At opacity .5 it composites to #acacac, 2.27:1. A scanner that reads color without the alpha passes it. Expected instances: 1.',
    `<p style="color:#595959;opacity:.5">Seat selection opens at check-in.</p>`),
  clean('text_contrast_opacity_passing', ['1.4.3'],
    'Text that still passes after opacity is applied',
    'Negative control for text_contrast_effective_opacity.html. #1a1a1a at opacity .85 composites to #3c3c3c, 11:1.',
    `<p style="color:#1a1a1a;opacity:.85">Seat selection opens at check-in.</p>`),
  clean('text_contrast_disabled_control', ['1.4.3'],
    'Disabled control with muted text',
    'Inactive user interface components are exempt from 1.4.3. A scanner that reports a disabled button is wrong.',
    `<button type="button" disabled style="color:#aaaaaa;background:#eeeeee;border:1px solid #cccccc">Pay now</button>`),

  // ───────────────── 1.4.11 non-text contrast
  flag('control_border_contrast_just_below', ['1.4.11'],
    'Input boundary at 2.99:1',
    'The border is the only thing that identifies the field. #959595 on white is 2.99:1, under the 3:1 line. Expected instances: 1.',
    `<label for="pax">Passenger name</label>
<input id="pax" type="text" style="border:1px solid #959595">`),
  clean('control_border_contrast_at_threshold', ['1.4.11'],
    'Input boundary at 3.03:1',
    'Negative control for control_border_contrast_just_below.html.',
    `<label for="pax">Passenger name</label>
<input id="pax" type="text" style="border:1px solid #949494">`),

  // ───────────────── 2.2.2 moving content, on and around the five second line
  flag('anim_finite_over_five_seconds', ['2.2.2'],
    'Finite animation that runs for six seconds',
    'Boundary. 2.2.2 applies to motion that lasts more than five seconds, and finite is not the same as short. Six one-second turns beside other content, with no pause. Expected instances: 1.',
    `<style>
@keyframes turn{to{transform:rotate(360deg)}}
.turn{animation:turn 1s linear 6;display:inline-block}
</style>
<div class="turn">&#9992;</div>
<p>Your search is running.</p>`),
  clean('anim_finite_exactly_five_seconds', ['2.2.2'],
    'Finite animation that runs for exactly five seconds',
    'Negative control for anim_finite_over_five_seconds.html. "More than five seconds" excludes five, so five one-second turns pass.',
    `<style>
@keyframes turn{to{transform:rotate(360deg)}}
.turn{animation:turn 1s linear 5;display:inline-block}
</style>
<div class="turn">&#9992;</div>
<p>Your search is running.</p>`),
  clean('anim_hidden_subject', ['2.2.2'],
    'Infinite animation on an element that is not rendered',
    'The rule exists and is infinite, but its subject is display:none, so nothing moves. Reporting it is a false positive.',
    `<style>
@keyframes turn{to{transform:rotate(360deg)}}
.turn{animation:turn 1s linear infinite}
</style>
<div class="turn" style="display:none">&#9992;</div>
<p>Nothing on this page moves.</p>`),
  clean('anim_with_pause_control', ['2.2.2'],
    'Infinite animation with a pause control',
    'A mechanism to pause is the 2.2.2 answer. The spinner runs indefinitely and the page offers a button that stops it.',
    `<style>
@keyframes turn{to{transform:rotate(360deg)}}
.turn{animation:turn 1s linear infinite;display:inline-block}
</style>
<div class="turn" id="spin">&#9992;</div>
<button type="button" onclick="document.getElementById('spin').style.animationPlayState='paused'">Pause animation</button>`),
  clean('anim_user_triggered_transition', ['2.2.2'],
    'Transition that only runs on hover',
    'Motion the user starts is not "starts automatically". A scanner that reports every transition is wrong.',
    `<style>.lift{transition:transform .2s}.lift:hover{transform:translateY(-2px)}</style>
<a class="lift" href="#fare">Flexible fare</a>`),
  flag('motion_rotation_no_pause', ['2.2.2'],
    'Rotating message with no pause',
    'Script swaps the message every 1.5s for as long as the page is open. Content that updates by itself beside other content needs a pause, stop or hide. Expected instances: 1.',
    `<p id="msg">Free cancellation on every fare.</p>
<p>Offers change every few seconds.</p>
<script>
var m=['Free cancellation on every fare.','Fly with one bag included.','Change your seat at no cost.'],i=0;
setInterval(function(){i=(i+1)%m.length;document.getElementById('msg').textContent=m[i];},1500);
</script>`),
  flag('motion_rotation_stops_after_eight_seconds', ['2.2.2'],
    'Rotating message that stops after eight seconds',
    'Boundary. The motion does end, but only after eight seconds with no pause. Expected instances: 1.',
    `<p id="msg">Free cancellation on every fare.</p>
<p>Offers change every second for a short while.</p>
<script>
var m=['Free cancellation on every fare.','Fly with one bag included.','Change your seat at no cost.'],i=0,n=0;
var t=setInterval(function(){i=(i+1)%m.length;document.getElementById('msg').textContent=m[i];if(++n>=8)clearInterval(t);},1000);
</script>`),
  clean('motion_rotation_stops_within_four_seconds', ['2.2.2'],
    'Rotating message that stops after four seconds',
    'Negative control for motion_rotation_stops_after_eight_seconds.html. Four seconds is under the limit, so no pause is required.',
    `<p id="msg">Free cancellation on every fare.</p>
<p>Offers change every second for a short while.</p>
<script>
var m=['Free cancellation on every fare.','Fly with one bag included.','Change your seat at no cost.'],i=0,n=0;
var t=setInterval(function(){i=(i+1)%m.length;document.getElementById('msg').textContent=m[i];if(++n>=4)clearInterval(t);},1000);
</script>`),
  clean('motion_rotation_with_pause', ['2.2.2'],
    'Rotating message with a pause control',
    'Negative control for motion_rotation_no_pause.html. The same rotation, with a button that stops it.',
    `<p id="msg">Free cancellation on every fare.</p>
<button type="button" id="pause">Pause offers</button>
<script>
var m=['Free cancellation on every fare.','Fly with one bag included.','Change your seat at no cost.'],i=0;
var t=setInterval(function(){i=(i+1)%m.length;document.getElementById('msg').textContent=m[i];},1500);
document.getElementById('pause').addEventListener('click',function(){clearInterval(t);});
</script>`),

  // ───────────────── 4.1.2 accessible names on elements that cannot carry one
  flag('aria_label_on_generic_div', ['4.1.2'],
    'aria-label on a div with no role',
    'A div has no role, so aria-label is prohibited on it and is not exposed. The label is the only thing that says what this square means, so the information is lost. Expected instances: 1.',
    `<div aria-label="Seat 12A is taken" style="width:1.5rem;height:1.5rem;background:#30556e"></div>`),
  flag('aria_label_on_generic_span', ['4.1.2'],
    'aria-label on a span with no role',
    'Same defect on the other generic element, again with no text for the label to repeat. Expected instances: 1.',
    `<p>Status: <span aria-label="Check-in is open" style="display:inline-block;width:1rem;height:1rem;background:#30556e;vertical-align:middle"></span></p>`),
  clean('aria_label_on_region_and_nav', ['4.1.2'],
    'aria-label on elements that support a name',
    'Negative control for the two aria_label_on_generic pages. A section, a nav and a role=group all take aria-label.',
    `<section aria-label="Fare summary"><p>One adult, one bag.</p></section>
<nav aria-label="Booking steps"><a href="#a">Search</a> <a href="#b">Pay</a></nav>
<div role="group" aria-label="Passenger details"><p>Adult, window seat.</p></div>`),
  clean('aria_label_on_role_img', ['4.1.2'],
    'aria-label on a div that has role=img',
    'Boundary. The same div that fails with no role is correct once it has a role that supports a name.',
    `<div role="img" aria-label="Seat map, row 12 selected" style="width:6rem;height:3rem;background:#30556e"></div>`),
  clean('aria_label_on_native_button', ['4.1.2'],
    'aria-label on a native button whose visible text is contained in it',
    'Negative control. A native control takes aria-label, and the name contains the visible words.',
    `<button type="button" aria-label="Search flights to Lisbon">Search flights</button>`),
  flag('aria_attribute_misspelled', ['4.1.2'],
    'Misspelled aria attribute',
    'aria-lable is not an ARIA attribute. It does nothing, and it is an invalid-attribute failure. Expected instances: 1.',
    `<button type="button" aria-lable="Close fare dialog">Close</button>`),
  clean('aria_attribute_spelled_correctly', ['4.1.2'],
    'Correctly spelled aria attribute',
    'Negative control for aria_attribute_misspelled.html.',
    `<button type="button" aria-label="Close fare dialog">Close</button>`),
  flag('aria_role_invalid', ['4.1.2'],
    'Role that does not exist',
    'role="buttn" is not a role. The element falls back to a generic div. Expected instances: 1.',
    `<div role="buttn" tabindex="0">Search flights</div>`),
  clean('aria_role_valid', ['4.1.2'],
    'Valid role with keyboard support',
    'Negative control for aria_role_invalid.html. A real role, focusable, with a key handler, so nothing else is declared.',
    `<div role="button" tabindex="0" onclick="void 0" onkeydown="if(event.key==='Enter'||event.key===' ')event.preventDefault()">Search flights</div>`),
  clean('aria_role_fallback_list', ['4.1.2'],
    'Role fallback list whose second token is valid',
    'Boundary. ARIA allows a space-separated list and uses the first token it recognises, so a list with one valid token is not an invalid role.',
    `<div role="unknownwidget button" tabindex="0" onclick="void 0" onkeydown="if(event.key==='Enter'||event.key===' ')event.preventDefault()">Search flights</div>`),
  flag('iframe_no_title', ['4.1.2'],
    'Frame with no title',
    'No title, no aria-label, no aria-labelledby. Expected instances: 1.',
    `<iframe srcdoc="<p>Terminal map placeholder</p>"></iframe>`),
  flag('iframe_empty_title', ['4.1.2'],
    'Frame with an empty title',
    'Boundary. title="" is present but gives no name. Expected instances: 1.',
    `<iframe title="" srcdoc="<p>Terminal map placeholder</p>"></iframe>`),
  clean('iframe_title', ['4.1.2'],
    'Frame with a title',
    'Negative control for the iframe pages.',
    `<iframe title="Terminal map" srcdoc="<p>Terminal map placeholder</p>"></iframe>`),
  clean('iframe_aria_label', ['4.1.2'],
    'Frame named with aria-label instead of title',
    'Boundary. An aria-label is an accessible name, so a frame with no title attribute is not a failure.',
    `<iframe aria-label="Terminal map" srcdoc="<p>Terminal map placeholder</p>"></iframe>`),

  // ───────────────── 1.3.1 required owned elements
  flag('role_menu_without_menuitems', ['1.3.1'],
    'role=menu whose children are not menu items',
    'A menu must own menuitem children. A navigation list marked up as a menu does not. Expected instances: 1.',
    `<ul role="menu">
<li><a href="#home">Home</a></li>
<li><a href="#trips">My trips</a></li>
<li><a href="#help">Help</a></li>
</ul>`),
  clean('role_menu_with_menuitems', ['1.3.1'],
    'role=menu that owns menu items',
    'Negative control for role_menu_without_menuitems.html. Each item is a menuitem, with its list-item role removed.',
    `<ul role="menu">
<li role="none"><a role="menuitem" href="#home">Home</a></li>
<li role="none"><a role="menuitem" href="#trips">My trips</a></li>
<li role="none"><a role="menuitem" href="#help">Help</a></li>
</ul>`),
  clean('role_menu_group_of_menuitems', ['1.3.1'],
    'role=menu that owns a group of menu items',
    'Boundary. A menu may own a named group, and the group owns the items. Reporting this as "no menu items" is wrong.',
    `<div role="menu">
<div role="group" aria-label="Account">
<a role="menuitem" href="#trips">My trips</a>
<a role="menuitem" href="#help">Help</a>
</div>
</div>`),
  flag('role_list_without_listitems', ['1.3.1'],
    'role=list whose children are not list items',
    'A list must own listitem children. Expected instances: 1.',
    `<div role="list"><div>Cabin bag</div><div>Personal item</div><div>Checked bag</div></div>`),
  clean('role_list_with_listitems', ['1.3.1'],
    'role=list that owns list items',
    'Negative control for role_list_without_listitems.html.',
    `<div role="list"><div role="listitem">Cabin bag</div><div role="listitem">Personal item</div><div role="listitem">Checked bag</div></div>`),

  // ───────────────── 2.4.4 links with no discernible text
  flag('link_no_text_variants', ['2.4.4'],
    'Five links that have no name, each in a different way',
    'An empty link, an image link with alt="", an SVG link with no title, a link holding only a non-breaking space, and a link holding only an aria-hidden glyph. Expected instances: 5 (#l1 to #l5). A scanner that counts four has missed one of the shapes.',
    `<p>
<a id="l1" href="#a"></a>
<a id="l2" href="#b"><img src="../pixel.png" alt="" width="24" height="24"></a>
<a id="l3" href="#c"><svg width="24" height="24" viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/></svg></a>
<a id="l4" href="#d">&nbsp;</a>
<a id="l5" href="#e"><span aria-hidden="true">&#9733;</span></a>
</p>`),
  clean('link_name_variants', ['2.4.4'],
    'Five links that are named, each in a different way',
    'Negative control for link_no_text_variants.html: aria-label, visually hidden text, an image with alt, an SVG with role=img and a label, and aria-labelledby pointing at visible text. Expected instances: 0.',
    `<style>.vh{position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%);white-space:nowrap}</style>
<p>
<a href="#a" aria-label="Open the map"><span aria-hidden="true">&#9733;</span></a>
<a href="#b"><span class="vh">Baggage rules</span><span aria-hidden="true">&#9733;</span></a>
<a href="#c"><img src="../pixel.png" alt="Home" width="24" height="24"></a>
<a href="#d"><svg role="img" aria-label="Help" width="24" height="24" viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/></svg></a>
<a href="#e" aria-labelledby="lbl">&#9733;</a> <span id="lbl">Seat map</span>
</p>`),
  clean('link_empty_in_hidden_container', ['2.4.4'],
    'Empty link inside a container that is not rendered',
    'Boundary. A link nobody can reach is not a link with no name. Reporting it inflates the count.',
    `<div hidden><a href="#a"></a></div>
<div style="display:none"><a href="#b"></a></div>
<p>Nothing on this page is an unnamed link.</p>`),
  clean('anchor_target_without_href', ['2.4.4'],
    'Empty anchor that is a target, not a link',
    'Boundary. An <a> with no href is not a link, so it needs no name. It is only a place to jump to.',
    `<p><a id="fares"></a><a href="#fares">Back to fares</a></p>`),

  // ───────────────── 1.1.1 text alternatives beyond a missing alt
  flag('img_alt_is_filename', ['1.1.1'],
    'Image whose alt text is a file name',
    'The attribute is present and says nothing. F30. Expected instances: 2.',
    `<img src="../pixel.png" alt="DSC_0042.jpg"><img src="../pixel.png" alt="image001.png">`),
  flag('input_image_no_alt', ['1.1.1'],
    'Image button with no alt',
    'type=image is an image that acts as a button, and it needs alt. Expected instances: 1.',
    `<form action="#" onsubmit="return false"><input type="image" src="../pixel.png" width="48" height="24"></form>`),
  clean('input_image_alt', ['1.1.1'],
    'Image button with alt',
    'Negative control for input_image_no_alt.html.',
    `<form action="#" onsubmit="return false"><input type="image" src="../pixel.png" alt="Search flights" width="48" height="24"></form>`),
  flag('svg_role_img_no_name', ['1.1.1'],
    'SVG with role=img and no name',
    'An SVG announced as an image with nothing to announce. Expected instances: 1.',
    `<svg role="img" width="48" height="24" viewBox="0 0 48 24"><rect width="48" height="24" fill="#30556e"/></svg>`),
  clean('svg_role_img_named', ['1.1.1'],
    'SVG with role=img and a name',
    'Negative control for svg_role_img_no_name.html.',
    `<svg role="img" aria-label="Airline logo" width="48" height="24" viewBox="0 0 48 24"><rect width="48" height="24" fill="#30556e"/></svg>`),
  clean('svg_decorative_hidden', ['1.1.1'],
    'Decorative SVG removed from the accessibility tree',
    'Boundary. aria-hidden marks an SVG as decoration, which is the declared intent that alt="" gives an image.',
    `<svg aria-hidden="true" focusable="false" width="48" height="24" viewBox="0 0 48 24"><rect width="48" height="24" fill="#30556e"/></svg>`),
  flag('area_no_alt', ['1.1.1'],
    'Image map area with no alt',
    'Each area of an image map is a link and needs its own text. Expected instances: 1.',
    `<img src="../pixel.png" alt="Terminal map" usemap="#terminals" width="200" height="100">
<map name="terminals"><area shape="rect" coords="0,0,100,100" href="#t1"></map>`),
  clean('area_alt', ['1.1.1'],
    'Image map area with alt',
    'Negative control for area_no_alt.html.',
    `<img src="../pixel.png" alt="Terminal map" usemap="#terminals" width="200" height="100">
<map name="terminals"><area shape="rect" coords="0,0,100,100" href="#t1" alt="Terminal 1"></map>`),

  // ───────────────── 2.1.1 scrollable regions
  flag('scroll_region_out_of_tab_order', ['2.1.1'],
    'Scrollable region removed from the tab order',
    'tabindex="-1" takes the scroller out of keyboard reach, and it holds no focusable content. Expected instances: 1. Measured on Chromium 1228: Tab skips tabindex="-1" and lands on the same scroller when the attribute is absent (scroll_region_no_tabindex.html).',
    `<div tabindex="-1" style="height:5rem;overflow:auto;border:1px solid #c9c9c9;padding:.5rem"><p style="min-height:24rem;margin:0">${LONG}</p></div>`),
  clean('scroll_region_no_tabindex', ['2.1.1'],
    'Scrollable region with no tabindex',
    'Negative control for scroll_region_out_of_tab_order.html. On Chromium 1228, Tab reaches an overflowing scroller that has no tabindex, even though element.tabIndex stays -1. A check that requires the attribute reports a region the keyboard can already scroll.',
    `<div style="height:5rem;overflow:auto;border:1px solid #c9c9c9;padding:.5rem"><p style="min-height:24rem;margin:0">${LONG}</p></div>`),
  clean('scroll_region_tabindex_zero', ['2.1.1'],
    'Scrollable region that is focusable and named',
    'Negative control for scroll_region_out_of_tab_order.html.',
    `<div tabindex="0" role="region" aria-label="Baggage rules" style="height:5rem;overflow:auto;border:1px solid #c9c9c9;padding:.5rem"><p style="min-height:24rem;margin:0">${LONG}</p></div>`),
  clean('scroll_region_with_focusable_child', ['2.1.1'],
    'Scrollable region that contains a link',
    'Boundary. A focusable child makes the region reachable, so a rule that demands tabindex on the scroller is wrong.',
    `<div style="height:5rem;overflow:auto;border:1px solid #c9c9c9;padding:.5rem"><p style="min-height:24rem;margin:0"><a href="#rules">Full baggage rules</a> ${LONG}</p></div>`),
  clean('scroll_region_not_overflowing', ['2.1.1'],
    'Scrollable region whose content fits',
    'Boundary. overflow:auto with nothing to scroll is not a scroller anyone needs to reach.',
    `<div tabindex="-1" style="height:8rem;overflow:auto;border:1px solid #c9c9c9;padding:.5rem"><p>One cabin bag and one personal item.</p></div>`),

  // ───────────────── 4.1.2 controls nested inside controls
  flag('button_contains_link', ['4.1.2'],
    'A link inside a button',
    'Interactive content is not allowed inside a button; the inner action is unreachable or doubled. Expected instances: 1.',
    `<button type="button">Fare details <a href="#more">more</a></button>`),
  flag('role_button_contains_input', ['4.1.2'],
    'A text field inside role=button',
    'A role=button owns its content as presentational, so the field inside it has no usable role. Expected instances: 1.',
    `<div role="button" tabindex="0">Tip <input type="text" aria-label="Tip amount"></div>`),
  clean('label_wraps_input', ['4.1.2'],
    'A label that wraps its input',
    'Negative control. A label around a control is the implicit association, not a nested control.',
    `<label>Passenger name <input type="text" name="pax"></label>`),
  clean('link_contains_image_and_text', ['4.1.2'],
    'A link that contains an image and text',
    'Negative control. Non-interactive content inside a link is the normal case.',
    `<a href="#fare"><img src="../pixel.png" alt="" width="24" height="24"> Flexible fare</a>`),

  // ───────────────── 2.1.1 click handling that is not on a control
  flag('click_handler_on_list_item', ['2.1.1'],
    'A click handler on a plain list item',
    'The item looks clickable and handles clicks, but a keyboard user cannot reach it. Expected instances: 1.',
    `<ul><li onclick="void 0" style="cursor:pointer">Seat 12A</li></ul>`),
  clean('click_delegation_on_list', ['2.1.1', '4.1.2'],
    'Click delegation on a list of real buttons',
    'Boundary. The handler is on the list, but every actionable thing inside it is a native button. Reporting the list is a false positive.',
    `<ul onclick="void 0"><li><button type="button">Add bag</button></li><li><button type="button">Add seat</button></li></ul>`),
  clean('click_listener_on_document', ['2.1.1', '4.1.2'],
    'A click listener on the document',
    'Boundary. Analytics and menu-dismiss listeners are not controls. The page has no element that depends on a pointer.',
    `<p><a href="#fare">Flexible fare</a></p>
<script>document.addEventListener('click',function(){});</script>`),

  // ───────────────── 1.3.1 grouping of related fields
  flag('radio_group_without_group', ['1.3.1'],
    'Related radios with no group',
    'Three radios share a name and a question, and nothing groups or names them. Expected instances: 1 group.',
    `<p>Meal preference</p>
<label><input type="radio" name="meal" value="v"> Vegetarian</label>
<label><input type="radio" name="meal" value="n"> No preference</label>
<label><input type="radio" name="meal" value="h"> Halal</label>`),
  clean('radio_group_fieldset_legend', ['1.3.1'],
    'Related radios in a fieldset with a legend',
    'Negative control for radio_group_without_group.html.',
    `<fieldset><legend>Meal preference</legend>
<label><input type="radio" name="meal" value="v"> Vegetarian</label>
<label><input type="radio" name="meal" value="n"> No preference</label>
<label><input type="radio" name="meal" value="h"> Halal</label>
</fieldset>`),
  clean('radio_group_role_radiogroup', ['1.3.1'],
    'Related radios in a role=radiogroup named by a visible heading',
    'Boundary. A fieldset is not the only valid grouping. role=radiogroup with aria-labelledby is equivalent.',
    `<p id="mealq">Meal preference</p>
<div role="radiogroup" aria-labelledby="mealq">
<label><input type="radio" name="meal" value="v"> Vegetarian</label>
<label><input type="radio" name="meal" value="n"> No preference</label>
<label><input type="radio" name="meal" value="h"> Halal</label>
</div>`),
  flag('checkbox_group_without_group', ['1.3.1'],
    'Related checkboxes with no group',
    'Three checkboxes answer one question and nothing groups or names them. Expected instances: 1 group.',
    `<p>Extras for this trip</p>
<label><input type="checkbox" name="extra" value="bag"> Extra bag</label>
<label><input type="checkbox" name="extra" value="seat"> Seat choice</label>
<label><input type="checkbox" name="extra" value="meal"> Meal</label>`),
  clean('single_checkbox_no_group', ['1.3.1'],
    'A single checkbox with no group',
    'Boundary. One checkbox has nothing to be grouped with, so a rule that wants a fieldset around every checkbox is wrong.',
    `<label><input type="checkbox" name="terms" value="y"> I accept the fare conditions</label>`),
  flag('fieldset_without_legend', ['1.3.1'],
    'Fieldset with no legend',
    'A group with no name. Expected instances: 1.',
    `<fieldset>
<label><input type="radio" name="seat" value="w"> Window</label>
<label><input type="radio" name="seat" value="a"> Aisle</label>
</fieldset>`),
  flag('fieldset_empty_legend', ['1.3.1'],
    'Fieldset with an empty legend',
    'Boundary. A legend element is present and gives no name. Expected instances: 1.',
    `<fieldset><legend></legend>
<label><input type="radio" name="seat" value="w"> Window</label>
<label><input type="radio" name="seat" value="a"> Aisle</label>
</fieldset>`),
  clean('fieldset_aria_label', ['1.3.1'],
    'Fieldset named with aria-label',
    'Boundary. An aria-label names a fieldset as well as a legend does.',
    `<fieldset aria-label="Seat position">
<label><input type="radio" name="seat" value="w"> Window</label>
<label><input type="radio" name="seat" value="a"> Aisle</label>
</fieldset>`),
  clean('fieldset_hidden_inputs_only', ['1.3.1'],
    'Fieldset that holds only hidden inputs',
    'Boundary. Hidden inputs show nothing, so there is no information for a group name to carry. Reporting it is a false positive.',
    `<form action="#" onsubmit="return false"><fieldset><input type="hidden" name="session" value="a1"><input type="hidden" name="locale" value="en"></fieldset>
<button type="submit">Continue</button></form>`),

  // ───────────────── 1.3.1 headings that are not headings
  flag('heading_styled_paragraph', ['1.3.1'],
    'A paragraph styled as a heading',
    'Large, bold, set apart and followed by the text it introduces, but marked up as a p. F2. Expected instances: 1.',
    `<p style="font-size:1.5rem;font-weight:700;margin:1.5rem 0 .5rem">Baggage allowance</p>
<p>Each passenger may carry one cabin bag and one personal item.</p>`),
  clean('heading_element_same_style', ['1.3.1'],
    'The same text as a real heading',
    'Negative control for heading_styled_paragraph.html. Identical appearance, correct element.',
    `<h2 style="font-size:1.5rem;font-weight:700;margin:1.5rem 0 .5rem">Baggage allowance</h2>
<p>Each passenger may carry one cabin bag and one personal item.</p>`),
  clean('heading_role_on_div', ['1.3.1'],
    'A heading made with role=heading',
    'Boundary. role=heading with aria-level is a heading, so a scanner that only looks for h1 to h6 is wrong.',
    `<div role="heading" aria-level="2" style="font-size:1.5rem;font-weight:700;margin:1.5rem 0 .5rem">Baggage allowance</div>
<p>Each passenger may carry one cabin bag and one personal item.</p>`),
  clean('bold_run_in_label', ['1.3.1'],
    'A bold lead-in word inside a paragraph',
    'Boundary. Bold text that is part of a sentence is emphasis, not a heading. Reporting it is a false positive.',
    `<p><strong>Note:</strong> Fares shown include taxes and one cabin bag.</p>`),

  // ───────────────── 2.4.7 focus visible, on and around "removed"
  flag('focus_indicator_nearly_invisible', ['2.4.7'],
    'Focus ring that is almost the page colour',
    'Boundary. An outline exists and is 1.02:1 against the background, so there is a ring on paper and none to the eye. Expected instances: 1.',
    `<style>a.ghost:focus-visible{outline:2px solid #fdfdfd;outline-offset:0}</style>
<a class="ghost" href="#rules">Baggage rules</a>`),
  clean('focus_box_shadow_ring', ['2.4.7'],
    'Outline removed and replaced by a box-shadow ring',
    'Boundary. The default outline is gone, and a 3px 7.9:1 ring takes its place. A scanner that only checks outline-style is wrong.',
    `<style>a.ring:focus-visible{outline:none;box-shadow:0 0 0 3px #30556e}</style>
<a class="ring" href="#rules">Baggage rules</a>`),
  clean('focus_transparent_outline_with_ring', ['2.4.7'],
    'Transparent outline plus a box-shadow ring',
    'Boundary. The transparent outline is the forced-colours fallback pattern. The ring is what sighted users see.',
    `<style>a.ring:focus-visible{outline:3px solid transparent;box-shadow:0 0 0 3px #30556e}</style>
<a class="ring" href="#rules">Baggage rules</a>`),
  flag('focus_image_link_outline_removed', ['2.4.7'],
    'Image link with its focus outline removed',
    'A link whose only content is an image, with outline:none and nothing in its place. Expected instances: 1.',
    `<style>a.imglink:focus-visible{outline:none}</style>
<a class="imglink" href="#home"><img src="../pixel.png" alt="Home" width="24" height="24"></a>`),
  flag('focus_input_outline_removed', ['2.4.7'],
    'Text field with its focus outline removed',
    'outline:none on focus and no border, shadow or background change in its place. Expected instances: 1.',
    `<style>input.bare:focus,input.bare:focus-visible{outline:none}</style>
<label for="q">Search</label>
<input id="q" class="bare" type="text">`),

  // ───────────────── 2.5.3 label in name
  flag('label_in_name_different_words', ['2.5.3'],
    'Accessible name that does not contain the visible label',
    'Visible "Open support options", name "Chat with an agent". A voice-control user says what they see and nothing happens. Expected instances: 1.',
    `<button type="button" aria-label="Chat with an agent">Open support options</button>`),
  flag('label_in_name_words_reordered', ['2.5.3'],
    'Accessible name that uses the visible words in a different order',
    'Boundary. Every visible word is in the name, but the visible string is not, which is what 2.5.3 tests. F96. Expected instances: 1.',
    `<button type="button" aria-label="Open options for support">Open support options</button>`),
  clean('label_in_name_extra_words', ['2.5.3'],
    'Accessible name that contains the visible label and more',
    'Boundary. The name contains the visible string, so it passes even though it is longer.',
    `<button type="button" aria-label="Open support options menu">Open support options</button>`),
  clean('label_in_name_case_differs', ['2.5.3'],
    'Accessible name that differs from the visible label only by case',
    'Boundary. The comparison is case-insensitive.',
    `<button type="button" aria-label="open support options">Open Support Options</button>`),
  clean('label_in_name_icon_only', ['2.5.3'],
    'Icon-only button with an accessible name',
    'Boundary. There is no visible text label, so there is nothing for the name to contain.',
    `<button type="button" aria-label="Open support options"><svg aria-hidden="true" focusable="false" width="16" height="16" viewBox="0 0 16 16"><circle cx="8" cy="8" r="6"/></svg></button>`),

  // ───────────────── 1.4.10 reflow
  flag('reflow_label_clipped_fixed_width', ['1.4.10'],
    'A label cut off at a fixed width',
    'A nowrap label in a box with overflow:hidden loses its end at 320 CSS px and cannot be read by scrolling. Expected instances: 1.',
    `<div style="width:12rem;overflow:hidden;white-space:nowrap;border:1px solid #c9c9c9;padding:.25rem">Passenger name exactly as it appears on the passport</div>`),
  clean('reflow_label_wraps', ['1.4.10'],
    'The same label allowed to wrap',
    'Negative control for reflow_label_clipped_fixed_width.html.',
    `<div style="width:12rem;border:1px solid #c9c9c9;padding:.25rem">Passenger name exactly as it appears on the passport</div>`),
  clean('reflow_data_table_scrolls_in_container', ['1.4.10'],
    'A wide data table that scrolls inside its own container',
    'Boundary. Two-dimensional data is an exception to reflow, so a table that scrolls in its own region while the page does not is correct.',
    `<div tabindex="0" role="region" aria-label="Fare table" style="overflow-x:auto">
<table style="min-width:44rem;border-collapse:collapse"><caption>Fares by cabin</caption>
<thead><tr><th scope="col">Cabin</th><th scope="col">Bag</th><th scope="col">Seat</th><th scope="col">Meal</th><th scope="col">Change</th><th scope="col">Refund</th><th scope="col">Lounge</th></tr></thead>
<tbody><tr><th scope="row">Basic</th><td>No</td><td>Fee</td><td>Fee</td><td>Fee</td><td>No</td><td>No</td></tr>
<tr><th scope="row">Flex</th><td>Yes</td><td>Free</td><td>Free</td><td>Free</td><td>Yes</td><td>No</td></tr></tbody></table>
</div>`),

  // ───────────────── 1.4.1 colour as the only cue for a link in text
  flag('link_in_text_colour_only', ['1.4.1'],
    'A link in running text told apart by colour alone',
    'No underline, and the link colour is 2.2:1 against the surrounding text, under the 3:1 that G183 needs. Expected instances: 1.',
    `<style>.runin a{text-decoration:none;color:#30556e;display:inline;padding:0;margin:0;min-height:0;min-width:0}</style>
<p class="runin">Read the <a href="#rules">baggage rules</a> before you travel.</p>`),
  clean('link_in_text_underlined', ['1.4.1'],
    'A link in running text that is underlined',
    'Negative control for link_in_text_colour_only.html.',
    `<style>.runin a{text-decoration:underline;color:#30556e;display:inline;padding:0;margin:0;min-height:0;min-width:0}</style>
<p class="runin">Read the <a href="#rules">baggage rules</a> before you travel.</p>`),
  clean('nav_links_no_underline', ['1.4.1'],
    'Navigation links with no underline',
    'Boundary. Links in a navigation list are not in a block of text, so colour alone is acceptable there. Reporting them is a false positive.',
    `<style>nav.plain a{text-decoration:none}</style>
<nav class="plain" aria-label="Booking steps"><a href="#a">Search</a> <a href="#b">Select</a> <a href="#c">Pay</a></nav>`),
];

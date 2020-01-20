import { Component } from './component.js';
import { musicBoxStore } from '../music-box-store.js';
import { playheadObserver } from '../services/playhead-observer.js';
import { sampler } from '../services/sampler.js';

export class NoteLine extends Component {
  constructor(props) {
    super({
      props,
      renderTrigger: `songState.songData.${props.id}`,
      element: document.querySelector(`[data-id="${props.id}"]`)
    });

    // We need to bind these in order to use "this" inside of them.
    this.showShadowNote = this.showShadowNote.bind(this);
    this.haveShadowNoteFollowCursor = this.haveShadowNoteFollowCursor.bind(this);
    this.handleClick = this.handleClick.bind(this);
    this.adjustStoredYPosForHoleSize = this.adjustStoredYPosForHoleSize.bind(this);
    this.adjustDisplayedYPosForHoleSize = this.adjustDisplayedYPosForHoleSize.bind(this);

    // Constants
    this.QUARTER_BAR_GAP = 50; // Pixel distance between the black quarter note bars.
    this.EIGHTH_BAR_GAP = 25; // Pixel distance between the gray eighth note bars.
    this.STANDARD_HOLE_RADIUS = 8; // Used only in calculations on stored note data.

    // Cached Constants
    this.holeWidth = null;
    this.holeRadius = null;

    // When a note is added or removed, the NoteLine is re-rendered underneath the cursor.
    // In this situation, the mouse events won't fire until you move the mouse again. This
    // led to some edge-cases where the shadow note wasn't being positioned properly during
    // repeated clicks. To fix this, we store the last shadow note position (and visibility)
    // details, so we can use them to set the initial shadow note position during re-renders.
    this.lastShadowNotePosition = 0;
    this.lastShadowNoteVisibilityClass = '';
  }

  // We base a lot of our math on the size of the hole, which is a CSS variable. This value
  // could change in the future to allow us to adjust the size of the paper. When this happens,
  // we want our math to continue working. Instead of looking up the CSS variable incessantly,
  // (like on hover) we use this function to look it up at key moments and cache the value in
  // the class instance. This simplifies our code and may improve performance.
  updateHoleSize() {
    this.holeWidth = parseInt(getComputedStyle(document.documentElement).getPropertyValue('--hole-width').trim());
    this.holeRadius = this.holeWidth / 2;
  }

  // We want the songData in state to be the same, regardless of whether the song was composed on
  // a screen showing small or large holes. This doesn't seem like it should be a problem, because the
  // vertical axis doesn't scale with hole size. HOWEVER, the distance between the top of the hole and
  // center of the hole DOES change with hole size. That's a problem because whenever we would add a hole,
  // its translateY value (which depended on the hole size) was getting stored. These functions allow
  // us to adjust the yPos when it goes into and out of storage, so it is always stored the same, but is
  // displayed with slight offsets whenever the hole-radius is non-standard.
  adjustDisplayedYPosForHoleSize(yPos) {
    return yPos - (this.STANDARD_HOLE_RADIUS - this.holeRadius);
  }
  adjustStoredYPosForHoleSize(yPos) {
    return yPos + (this.STANDARD_HOLE_RADIUS - this.holeRadius);
  }

  showShadowNote(event) {
    const shadowNoteEl = event.currentTarget.querySelector('.shadow-note');

    this.updateHoleSize();

    this.lastShadowNoteVisibilityClass = 'shadow-note--visible';
    shadowNoteEl.classList.add('shadow-note--visible');
  }

  hideShadowNote(event) {
    const shadowNoteEl = event.currentTarget.querySelector('.shadow-note');

    this.lastShadowNotePosition = 0;
    this.lastShadowNoteVisibilityClass = '';
    shadowNoteEl.style = `transform: translateY(0px)`;
    shadowNoteEl.classList.remove('shadow-note--visible');
  }

  haveShadowNoteFollowCursor(event) {
    const shadowNoteEl = event.currentTarget.querySelector('.shadow-note');

    this.positionShadowNote(shadowNoteEl, event.pageY);
  }

  positionShadowNote(shadowNoteEl, cursorPositionPageY) {
    // We're building the translateY value for the shadow note, but the web apis aren't ideal so we have to cobble it
    // together from the properties we have. For noteLinesPageOffsetTop, see https://stackoverflow.com/q/34422189/1154642
    const noteLinesPageOffsetTop = document.querySelector('#note-lines').getBoundingClientRect().top + window.scrollY;
    const relativeCursorYPos = cursorPositionPageY - noteLinesPageOffsetTop;
    let noteYPosition;

    // Prevent users from positioning notes too high on the note line.
    if (relativeCursorYPos < this.holeRadius) {
      return false;
    }

    if (musicBoxStore.state.appState.isSnappingToGrid) {
      const topPixelOffset = this.holeRadius;

      const snapToNearestBar = val => (
        Math.round((val - topPixelOffset) / this.EIGHTH_BAR_GAP) * this.EIGHTH_BAR_GAP + topPixelOffset
      );

      noteYPosition = snapToNearestBar(relativeCursorYPos - this.holeRadius);
    } else {
      noteYPosition = relativeCursorYPos - this.holeRadius;
    }

    this.lastShadowNotePosition = noteYPosition;
    shadowNoteEl.style = `transform: translateY(${noteYPosition}px)`;
  }

  handleClick(event) {
    const noteLineEl = event.currentTarget;
    const shadowNoteEl = noteLineEl.querySelector('.shadow-note');
    const pitch = noteLineEl.getAttribute('data-id');

    const isShadowNoteOverlappingExistingNote = shadowNoteYPos => (
      musicBoxStore.state.songState.songData[pitch].includes(shadowNoteYPos)
    );

    const getNoteYPos = element => {
      const yposMatch = element.style.transform.match(/translateY\((\d+\.?\d*)px\)/); // https://regex101.com/r/49U5Dx/1
      return (yposMatch && yposMatch[1]) ? parseInt(yposMatch[1]) : console.error("Couldn't find note position");
    };

    const shadowNoteYPos = getNoteYPos(shadowNoteEl);

    if (event.target.classList.contains('hole')) {
      this.removeNote(pitch, getNoteYPos(event.target));
    }
    else if (isShadowNoteOverlappingExistingNote(shadowNoteYPos)) {
      // This case happens when snap-to-grid allows you to click when your
      // cursor isn't on an existing note but your shadow note is.
      this.removeNote(pitch, shadowNoteYPos);
    }
    else {
      this.addNote(pitch, shadowNoteYPos)
    }
  }

  addNote(pitch, yPos) {
    const storedYPos = this.adjustStoredYPosForHoleSize(yPos);
    const newPitchArray =
      [...musicBoxStore.state.songState.songData[pitch]]
        .concat(storedYPos)
        .sort((a, b) => Number(a) - Number(b));

    sampler.triggerAttackRelease(pitch, '8n');
    musicBoxStore.setState(`songState.songData.${pitch}`, newPitchArray);
  }

  removeNote(pitch, yPos) {
    const storedYPos = this.adjustStoredYPosForHoleSize(yPos);
    const newPitchArray =
      [...musicBoxStore.state.songState.songData[pitch]]
        .filter(val => val !== storedYPos);

    musicBoxStore.setState(`songState.songData.${pitch}`, newPitchArray);
  }

  renderNotes(pitch) {
    const notesArray = musicBoxStore.state.songState.songData[pitch];

    // The "dead zone" is the region after a note, wherein if a note is placed, it
    // will display as red and will not play a note (due to mechanical limitations).
    // We base this length on the actual boxes, and the STANDARD_HOLE_RADIUS to ensure
    // the dead-zone is the same when we use different hole-sizes.
    const deadZoneLength = this.QUARTER_BAR_GAP - this.STANDARD_HOLE_RADIUS - 1;
    let lastPlayableNoteYPos = 0;
    let notesMarkup = '';

    notesArray.forEach((yPos, i) => {
      const isNotePlayable = (i === 0) ? true : (yPos - lastPlayableNoteYPos > deadZoneLength);
      lastPlayableNoteYPos = isNotePlayable ? yPos : lastPlayableNoteYPos; // update this scoped variable.

      const displayedYPos = this.adjustDisplayedYPosForHoleSize(yPos);

      notesMarkup += `<button class="hole ${isNotePlayable ? '' : 'silent'}" style="transform: translateY(${displayedYPos}px)"></button>`;
    });

    return notesMarkup;
  }

  render() {
    this.updateHoleSize();

    // Prevent weird bugs by removing observers from any existing notes, before re-rendering.
    this.element.querySelectorAll('.hole').forEach(hole => playheadObserver.get().unobserve(hole));

    this.element.innerHTML = `
      <div class="shadow-note ${this.lastShadowNoteVisibilityClass}" style="transform: translateY(${this.lastShadowNotePosition}px)"></div>
      ${this.renderNotes(this.props.id)}
    `;

    this.element.querySelectorAll('.hole').forEach(hole => playheadObserver.get().observe(hole));
    this.element.addEventListener('mouseenter', this.showShadowNote);
    this.element.addEventListener('mouseleave', this.hideShadowNote);
    this.element.addEventListener('mousemove', this.haveShadowNoteFollowCursor);
    this.element.addEventListener('click', this.handleClick);
  }
}

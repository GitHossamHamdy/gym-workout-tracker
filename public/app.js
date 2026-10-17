const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const form = $('#workout-form');
const exerciseList = $('#exercises');
const state = { editingId: null, dirty: false, saving: false, historyRequest: 0 };

function today() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}
function formatDate(date) {
  const [year, month, day] = date.split('-');
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${Number(day)} ${months[Number(month) - 1]} ${year}`;
}
function message(selector, text) {
  const element = $(selector);
  element.textContent = text;
  element.hidden = !text;
}
function showFormError(text) {
  message('#form-success', '');
  message('#form-error', text);
  $('#form-error').focus();
}
async function request(path, options = {}) {
  let response;
  try {
    response = await fetch(path, { ...options, headers: { 'Content-Type': 'application/json', ...options.headers } });
  } catch {
    throw new Error('Cannot reach the journal. Check that the local server is running, then try again. Your form has been kept.');
  }
  if (response.status === 204) return null;
  let data;
  try { data = await response.json(); } catch { throw new Error('The server returned an unreadable response. Please try again.'); }
  if (!response.ok) throw new Error(data.details?.join(' ') || data.error || 'Something went wrong. Please try again.');
  return data;
}
function markDirty() { state.dirty = true; message('#form-success', ''); }
function canDiscard() { return !state.dirty || window.confirm('Discard your unsaved workout changes?'); }

function renumber() {
  const exercises = $$('.exercise', exerciseList);
  $('#add-exercise').disabled = exercises.length >= 50;
  exercises.forEach((exercise, index) => {
    $('.exercise-legend', exercise).textContent = `Exercise ${String(index + 1).padStart(2, '0')}`;
    const removeExercise = $('.remove-exercise', exercise);
    removeExercise.disabled = exercises.length === 1;
    removeExercise.setAttribute('aria-label', `Remove exercise ${index + 1}`);
    $('.exercise-name', exercise).setAttribute('aria-label', `Exercise ${index + 1} name`);
    const sets = $$('.set-row', exercise);
    $('.add-set', exercise).disabled = sets.length >= 50;
    sets.forEach((row, setIndex) => {
      $('.set-number', row).textContent = setIndex + 1;
      const context = `exercise ${index + 1}, set ${setIndex + 1}`;
      $('.set-weight', row).setAttribute('aria-label', `Weight for ${context}`);
      $('.set-reps', row).setAttribute('aria-label', `Reps for ${context}`);
      $('.set-unit', row).setAttribute('aria-label', `Weight unit for ${context}`);
      const remove = $('.remove-set', row);
      remove.disabled = sets.length === 1;
      remove.setAttribute('aria-label', `Remove ${context}`);
    });
  });
}
function addSet(exercise, set) {
  if ($$('.set-row', exercise).length >= 50) return;
  const row = $('#set-template').content.firstElementChild.cloneNode(true);
  $('.set-weight', row).value = set?.weight ?? '';
  $('.set-reps', row).value = set?.reps ?? '';
  $('.set-unit', row).value = set?.unit ?? $('#default-unit').value;
  $('.remove-set', row).addEventListener('click', () => {
    row.remove(); renumber(); markDirty(); $('.add-set', exercise).focus();
  });
  $('.sets', exercise).append(row);
  renumber();
  return row;
}
function addExercise(data) {
  if ($$('.exercise', exerciseList).length >= 50) return;
  const exercise = $('#exercise-template').content.firstElementChild.cloneNode(true);
  $('.exercise-name', exercise).value = data?.name ?? '';
  $('.remove-exercise', exercise).addEventListener('click', () => {
    exercise.remove(); renumber(); markDirty(); $('#add-exercise').focus();
  });
  $('.add-set', exercise).addEventListener('click', () => {
    const row = addSet(exercise); markDirty(); $('.set-weight', row).focus();
  });
  exerciseList.append(exercise);
  (data?.sets ?? [null]).forEach((set) => addSet(exercise, set));
  renumber();
  return exercise;
}
function resetEditor() {
  state.editingId = null;
  state.dirty = false;
  $('#workout-date').value = today();
  exerciseList.replaceChildren();
  addExercise();
  $('#editor-title').textContent = 'New workout';
  $('#editor-mode').textContent = "LET'S GO";
  $('#save-workout').textContent = 'Save workout ↗';
  $('#reset-workout').textContent = 'Clear form';
  message('#form-error', '');
}
function editWorkout(workout) {
  if (state.saving || !canDiscard()) return;
  state.editingId = workout.id;
  state.dirty = false;
  $('#workout-date').value = workout.date;
  exerciseList.replaceChildren();
  workout.exercises.forEach(addExercise);
  $('#editor-title').textContent = 'Edit workout';
  $('#editor-mode').textContent = 'EDITING';
  $('#save-workout').textContent = 'Save changes ↗';
  $('#reset-workout').textContent = 'Cancel editing';
  message('#form-error', ''); message('#form-success', '');
  $('#editor').scrollIntoView({ block: 'start' });
  $('.exercise-name', exerciseList).focus({ preventScroll: true });
}
function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}
function renderHistory(workouts) {
  const list = $('#workout-list');
  list.replaceChildren();
  $('#workout-count').textContent = workouts.length;
  if (!workouts.length) {
    const empty = element('div', 'empty-state');
    empty.append(element('h3', '', $('#history-date').value ? 'A fresh page.' : 'Your first set starts here.'), element('p', '', $('#history-date').value ? 'No workouts on this date. Choose another date or show all.' : 'Save a workout and it will appear here, ready to revisit.'));
    list.append(empty);
    return;
  }
  for (const workout of workouts) {
    const card = element('article', 'workout-card');
    const top = element('div', 'workout-top');
    const heading = element('div');
    const title = element('h3', 'workout-date');
    const time = element('time', '', formatDate(workout.date));
    time.dateTime = workout.date;
    title.append(time);
    const sets = workout.exercises.reduce((total, exercise) => total + exercise.sets.length, 0);
    heading.append(title, element('p', 'workout-meta', `${workout.exercises.length} exercise${workout.exercises.length === 1 ? '' : 's'} · ${sets} set${sets === 1 ? '' : 's'}`));
    const controls = element('div', 'workout-controls');
    const edit = element('button', 'button quiet', 'Edit');
    edit.type = 'button'; edit.setAttribute('aria-label', `Edit workout from ${formatDate(workout.date)}`);
    edit.addEventListener('click', () => editWorkout(workout));
    const remove = element('button', 'button quiet danger', 'Delete');
    remove.type = 'button'; remove.setAttribute('aria-label', `Delete workout from ${formatDate(workout.date)}`);
    remove.addEventListener('click', () => deleteWorkout(workout, remove));
    controls.append(edit, remove); top.append(heading, controls); card.append(top);
    const exercises = element('ul', 'workout-exercises');
    for (const exercise of workout.exercises) {
      const item = element('li');
      item.append(element('strong', '', exercise.name));
      const chips = element('div', 'set-chips');
      for (const set of exercise.sets) chips.append(element('span', 'set-chip', `${set.weight} ${set.unit} × ${set.reps}`));
      item.append(chips); exercises.append(item);
    }
    card.append(exercises); list.append(card);
  }
}
async function loadHistory() {
  const requestId = ++state.historyRequest;
  const date = $('#history-date').value;
  $('#workout-list').setAttribute('aria-busy', 'true');
  message('#history-error', ''); $('#retry-history').hidden = true;
  message('#history-status', 'Loading your workouts…');
  try {
    const data = await request(`/api/workouts${date ? `?date=${encodeURIComponent(date)}` : ''}`);
    if (requestId !== state.historyRequest) return;
    renderHistory(data.workouts);
    message('#history-status', data.workouts.length ? `${data.workouts.length} workout${data.workouts.length === 1 ? '' : 's'}${date ? ' on this date' : ' · newest first'}` : '');
  } catch (error) {
    if (requestId !== state.historyRequest) return;
    message('#history-error', error.message);
    message('#history-status', 'History could not be refreshed. Any previously loaded results are unchanged.');
    $('#retry-history').hidden = false;
  } finally {
    if (requestId === state.historyRequest) $('#workout-list').setAttribute('aria-busy', 'false');
  }
}
async function deleteWorkout(workout, button) {
  if (state.saving) return;
  const extra = state.editingId === workout.id && state.dirty ? ' Unsaved edits to this workout will also be discarded.' : '';
  if (!window.confirm(`Delete the workout from ${formatDate(workout.date)}? This cannot be undone.${extra}`)) return;
  state.saving = true;
  button.disabled = true;
  $('#editor-fields').disabled = true;
  try {
    await request(`/api/workouts/${workout.id}`, { method: 'DELETE' });
    if (state.editingId === workout.id) resetEditor();
    message('#form-success', 'Workout deleted.');
    await loadHistory();
  } catch (error) {
    message('#history-error', error.message);
  } finally {
    state.saving = false;
    button.disabled = false;
    $('#editor-fields').disabled = false;
  }
}

form.addEventListener('input', markDirty);
form.addEventListener('change', markDirty);
$('#add-exercise').addEventListener('click', () => {
  const exercise = addExercise(); markDirty(); $('.exercise-name', exercise).focus();
});
$('#reset-workout').addEventListener('click', () => {
  if (canDiscard()) { resetEditor(); message('#form-success', ''); $('#workout-date').focus(); }
});
form.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (state.saving || !form.reportValidity()) return;
  const workout = {
    date: $('#workout-date').value,
    exercises: $$('.exercise', exerciseList).map((exercise) => ({
      name: $('.exercise-name', exercise).value,
      sets: $$('.set-row', exercise).map((row) => ({
        weight: Number($('.set-weight', row).value), reps: Number($('.set-reps', row).value), unit: $('.set-unit', row).value,
      })),
    })),
  };
  const editing = state.editingId;
  state.saving = true;
  $('#editor-fields').disabled = true;
  $('#save-workout').textContent = 'Saving…';
  message('#form-error', ''); message('#form-success', '');
  try {
    await request(editing ? `/api/workouts/${editing}` : '/api/workouts', { method: editing ? 'PUT' : 'POST', body: JSON.stringify(workout) });
    resetEditor();
    message('#form-success', `${editing ? 'Changes' : 'Workout'} saved for ${formatDate(workout.date)}.`);
    await loadHistory();
  } catch (error) { showFormError(error.message); }
  finally {
    state.saving = false;
    $('#editor-fields').disabled = false;
    $('#save-workout').textContent = state.editingId ? 'Save changes ↗' : 'Save workout ↗';
  }
});
$('#history-date').addEventListener('change', loadHistory);
$('#show-all').addEventListener('click', () => { $('#history-date').value = ''; loadHistory(); });
$('#retry-history').addEventListener('click', loadHistory);
window.addEventListener('beforeunload', (event) => {
  if (state.dirty || state.saving) { event.preventDefault(); event.returnValue = ''; }
});
resetEditor();
loadHistory();

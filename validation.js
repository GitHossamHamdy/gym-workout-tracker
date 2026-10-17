export const LIMITS = Object.freeze({ exercises: 50, sets: 50, name: 100, weight: 100000, reps: 10000 });

const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

// Validate calendar components directly: never convert a workout date to a timestamp.
export function isCalendarDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return year >= 1 && month >= 1 && month <= 12 && day >= 1 && day <= days[month - 1];
}

export function validateWorkout(input) {
  const errors = [];
  if (!isObject(input)) return { errors: ['A workout must be a JSON object.'] };
  if (!isCalendarDate(input.date)) errors.push('Choose a valid calendar date (YYYY-MM-DD).');
  if (!Array.isArray(input.exercises) || input.exercises.length < 1 || input.exercises.length > LIMITS.exercises) {
    errors.push(`Include between 1 and ${LIMITS.exercises} exercises.`);
    return { errors };
  }
  const exercises = input.exercises.map((exercise, index) => {
    const prefix = `Exercise ${index + 1}`;
    if (!isObject(exercise)) {
      errors.push(`${prefix} must be an object.`);
      return null;
    }
    const name = typeof exercise.name === 'string' ? exercise.name.trim() : '';
    if (!name || name.length > LIMITS.name || /[\u0000-\u001f\u007f]/.test(name)) errors.push(`${prefix}: enter a name of 1–${LIMITS.name} characters without control characters.`);
    if (!Array.isArray(exercise.sets) || exercise.sets.length < 1 || exercise.sets.length > LIMITS.sets) {
      errors.push(`${prefix}: include between 1 and ${LIMITS.sets} sets.`);
      return null;
    }
    const sets = exercise.sets.map((set, setIndex) => {
      const label = `${prefix}, set ${setIndex + 1}`;
      if (!isObject(set)) {
        errors.push(`${label} must be an object.`);
        return null;
      }
      if (typeof set.weight !== 'number' || !Number.isFinite(set.weight) || set.weight < 0 || set.weight > LIMITS.weight) {
        errors.push(`${label}: weight must be a number from 0 to ${LIMITS.weight}.`);
      }
      if (!Number.isInteger(set.reps) || set.reps < 1 || set.reps > LIMITS.reps) {
        errors.push(`${label}: reps must be a whole number from 1 to ${LIMITS.reps}.`);
      }
      if (!['kg', 'lb'].includes(set.unit)) errors.push(`${label}: choose kg or lb.`);
      return { weight: set.weight, reps: set.reps, unit: set.unit };
    });
    return { name, sets };
  });
  return { errors, value: { date: input.date, exercises } };
}

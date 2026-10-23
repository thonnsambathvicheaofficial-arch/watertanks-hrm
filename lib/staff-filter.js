// The one definition of "does this person pass the Group / Department filter", used by the report engine and every
// staff list, so Live, Reports, Roster, Staff, Leave and Rotation can never disagree about who is in a filter.
const NO_DEPARTMENT = 'none'   // the filter value that picks staff who have no department yet

// want: '' (no filter), 'none', or a department id. have: the person's department id ('' / null when unassigned).
const matchesDepartment = (want, have) => !want || (want === NO_DEPARTMENT ? !have : have === want)
// want: '' (no filter), 'office' or 'worker'. have: the person's group (null when not set).
const matchesGroup = (want, have) => !want || (have || null) === want

// want: what was typed in a search box ('' = no search). person: { pin, name, nameKh, staffCode, position }. Matches name, PIN, Staff ID,
// position and Khmer name; case does not matter, and a search of several words must find all of them ("chan sop").
function matchesSearch(want, person) {
  const words = String(want || '').trim().toLowerCase().split(/\s+/).filter(Boolean)
  if (!words.length) return true
  const hay = [person.pin, person.name, person.staffCode, person.position].map(v => String(v || '').toLowerCase()).join('\n') + '\n' + String(person.nameKh || '')
  return words.every(w => hay.includes(w))
}

module.exports = { NO_DEPARTMENT, matchesDepartment, matchesGroup, matchesSearch }

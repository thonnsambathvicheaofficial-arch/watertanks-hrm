// The one definition of "does this person pass the Group / Department filter", used by the report engine and every
// staff list, so Live, Reports, Roster, Staff, Leave and Rotation can never disagree about who is in a filter.
const NO_DEPARTMENT = 'none'   // the filter value that picks staff who have no department yet

// want: '' (no filter), 'none', or a department id. have: the person's department id ('' / null when unassigned).
const matchesDepartment = (want, have) => !want || (want === NO_DEPARTMENT ? !have : have === want)
// want: '' (no filter), 'office' or 'worker'. have: the person's group (null when not set).
const matchesGroup = (want, have) => !want || (have || null) === want

module.exports = { NO_DEPARTMENT, matchesDepartment, matchesGroup }

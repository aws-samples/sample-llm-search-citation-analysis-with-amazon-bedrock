import {
  describe, expect, it
} from 'vitest';
import { buildUser } from '../../hooks/useUserManagement-fixtures';
import {
  filterUsers, isFiltering, NO_USERS_FILTER, summarizeUsers
} from './UsersFilter';

const admin = buildUser({
  username: 'ana',
  email: 'Ana@Hotel.example',
  groups: ['Users', 'Admin'],
});
const pending = buildUser({
  username: 'bo',
  email: 'bo@hotel.example',
  status: 'FORCE_CHANGE_PASSWORD',
});
const disabled = buildUser({
  username: 'cy',
  email: 'cy@other.example',
  enabled: false,
});
const everyone = [admin, pending, disabled];

describe('filterUsers', () => {
  it('keeps everyone without a filter', () => {
    expect(filterUsers(everyone, NO_USERS_FILTER)).toStrictEqual(everyone);
  });

  it('matches part of the email whatever its letter case', () => {
    expect(filterUsers(everyone, {
      ...NO_USERS_FILTER,
      query: ' HOTEL ',
    })).toStrictEqual([admin, pending]);
  });

  it('keeps only the role picked', () => {
    expect(filterUsers(everyone, {
      ...NO_USERS_FILTER,
      role: 'member',
    })).toStrictEqual([pending, disabled]);
  });

  it('keeps only the status picked', () => {
    expect(filterUsers(everyone, {
      ...NO_USERS_FILTER,
      status: 'pending',
    })).toStrictEqual([pending]);
  });
});

describe('isFiltering', () => {
  it('is false for the empty filter and a blank query', () => {
    expect(isFiltering({
      ...NO_USERS_FILTER,
      query: '  ',
    })).toBe(false);
  });

  it('is true once a status is picked', () => {
    expect(isFiltering({
      ...NO_USERS_FILTER,
      status: 'disabled',
    })).toBe(true);
  });
});

describe('summarizeUsers', () => {
  it('counts people, pending invites and disabled accounts', () => {
    expect(summarizeUsers(everyone)).toBe('3 people · 1 invite pending · 1 disabled');
  });

  it('leaves out the pending and disabled counts when they are zero', () => {
    expect(summarizeUsers([admin])).toBe('1 person');
  });

  it('pluralises pending invites', () => {
    expect(summarizeUsers([pending, pending])).toBe('2 people · 2 invites pending');
  });
});

// Sync Feature Module — validateJsonValue 单元测试 (V5.4.3)
import { describe, it, expect } from 'vitest';
import { validateJsonValue } from './validate-json-value';

// ─── Basic types (round-trip) ─────────────────────────────────────

describe('validateJsonValue — basic types', () => {
  it('accepts string', () => {
    expect(validateJsonValue('hello')).toBe('hello');
  });

  it('accepts finite number', () => {
    expect(validateJsonValue(42)).toBe(42);
    expect(validateJsonValue(-1.5)).toBe(-1.5);
    expect(validateJsonValue(0)).toBe(0);
  });

  it('accepts boolean', () => {
    expect(validateJsonValue(true)).toBe(true);
    expect(validateJsonValue(false)).toBe(false);
  });

  it('accepts null', () => {
    expect(validateJsonValue(null)).toBe(null);
  });

  it('accepts plain object', () => {
    const obj = { name: 'test', count: 5, active: true, meta: null };
    expect(validateJsonValue(obj)).toEqual(obj);
  });

  it('accepts plain array', () => {
    const arr = [1, 'two', true, null, { key: 'value' }];
    expect(validateJsonValue(arr)).toEqual(arr);
  });

  it('accepts nested structures', () => {
    const nested = {
      warehouses: [
        { id: 1, name: 'PH', skus: ['A', 'B'] },
        { id: 2, name: 'VN', skus: ['C'] },
      ],
    };
    expect(validateJsonValue(nested)).toEqual(nested);
  });

  it('accepts empty object', () => {
    expect(validateJsonValue({})).toEqual({});
  });

  it('accepts empty array', () => {
    expect(validateJsonValue([])).toEqual([]);
  });

  it('accepts null-prototype object', () => {
    const obj = Object.create(null);
    obj.name = 'test';
    expect(validateJsonValue(obj)).toEqual({ name: 'test' });
  });
});

// ─── Return identity (returns original reference) ─────────────────

describe('validateJsonValue — return identity', () => {
  it('returns same object reference', () => {
    const obj = { a: 1, b: { c: 'hello' } };
    expect(validateJsonValue(obj)).toBe(obj);
  });

  it('returns same array reference', () => {
    const arr = [1, 2, { x: 3 }];
    expect(validateJsonValue(arr)).toBe(arr);
  });

  it('does not create new object for nested values', () => {
    const child = { x: 1 };
    const parent = { a: child };
    const result = validateJsonValue(parent) as Record<string, unknown>;
    expect(result.a).toBe(child);
  });

  it('does not create new array for nested arrays', () => {
    const inner = [1, 2];
    const outer = [inner, 3];
    const result = validateJsonValue(outer) as unknown[];
    expect(result[0]).toBe(inner);
  });
});

// ─── __proto__ key handling ──────────────────────────────────────

describe('validateJsonValue — __proto__ key', () => {
  it('preserves __proto__ as own property on JSON-parsed object', () => {
    // JSON.parse treats __proto__ as a regular own property
    const obj = JSON.parse('{"__proto__": {"a": 1}, "name": "test"}');
    expect(obj.__proto__).toEqual({ a: 1 });
    // validate must not lose or modify the __proto__ property
    const result = validateJsonValue(obj);
    expect(result).toBe(obj);
    expect((result as Record<string, unknown>).__proto__).toEqual({ a: 1 });
    // Object.getOwnPropertyDescriptor confirms it's an own property
    const desc = Object.getOwnPropertyDescriptor(obj, '__proto__');
    expect(desc).not.toBeUndefined();
    expect(desc!.value).toEqual({ a: 1 });
  });

  it('allows __proto__ key with primitive value', () => {
    const obj = JSON.parse('{"__proto__": "string-value"}');
    const result = validateJsonValue(obj);
    expect(result).toBe(obj);
  });

  it('allows __proto__ key with null value', () => {
    const obj = JSON.parse('{"__proto__": null}');
    const result = validateJsonValue(obj);
    expect(result).toBe(obj);
  });

  it('allows __proto__ key in nested objects', () => {
    const obj = JSON.parse(
      '{"data": {"__proto__": {"nested": true}}, "name": "test"}',
    );
    const result = validateJsonValue(obj);
    expect(result).toBe(obj);
    const data = (result as Record<string, unknown>).data as Record<string, unknown>;
    expect(data.__proto__).toEqual({ nested: true });
  });

  it('still rejects __proto__ with invalid value types', () => {
    const obj = JSON.parse('{"__proto__": null}');
    // Overwrite with an invalid value
    Object.defineProperty(obj, '__proto__', {
      value: undefined,
      enumerable: true,
      configurable: true,
      writable: true,
    });
    expect(() => validateJsonValue(obj)).toThrow('undefined');
  });
});

// ─── Serialization round-trip ─────────────────────────────────────

describe('validateJsonValue — serialization round-trip', () => {
  it('round-trips through JSON.stringify/parse without loss', () => {
    const obj = {
      name: 'test',
      count: 42,
      active: true,
      meta: null,
      items: [1, 'two', { nested: true }],
    };
    validateJsonValue(obj);
    const roundTripped = JSON.parse(JSON.stringify(obj));
    expect(roundTripped).toEqual(obj);
  });

  it('round-trip preserves __proto__ key content', () => {
    const obj = JSON.parse('{"__proto__": {"inner": 42}}');
    validateJsonValue(obj);
    const roundTripped = JSON.parse(JSON.stringify(obj));
    expect(roundTripped.__proto__).toEqual({ inner: 42 });
  });
});

// ─── Rejected types ───────────────────────────────────────────────

describe('validateJsonValue — rejected types', () => {
  it('rejects undefined', () => {
    expect(() => validateJsonValue(undefined)).toThrow(
      'JsonValue 不允许 undefined',
    );
  });

  it('rejects undefined at root path', () => {
    expect(() => validateJsonValue(undefined)).toThrow('root');
  });

  it('rejects nested undefined property value', () => {
    expect(() => validateJsonValue({ key: undefined })).toThrow('root.key');
  });

  it('rejects function', () => {
    expect(() => validateJsonValue(() => {})).toThrow('JsonValue 不允许函数');
  });

  it('rejects Symbol', () => {
    expect(() => validateJsonValue(Symbol('test'))).toThrow(
      'JsonValue 不允许 Symbol',
    );
  });

  it('rejects BigInt', () => {
    expect(() => validateJsonValue(BigInt(123))).toThrow(
      'JsonValue 不允许 BigInt',
    );
  });

  it('rejects NaN', () => {
    expect(() => validateJsonValue(NaN)).toThrow('NaN');
  });

  it('rejects Infinity', () => {
    expect(() => validateJsonValue(Infinity)).toThrow('Infinity');
  });

  it('rejects -Infinity', () => {
    expect(() => validateJsonValue(-Infinity)).toThrow('Infinity');
  });
});

// ─── toJSON rejection ─────────────────────────────────────────────

describe('validateJsonValue — toJSON rejection', () => {
  it('rejects object with toJSON', () => {
    const obj = { name: 'test', toJSON: () => 'override' };
    expect(() => validateJsonValue(obj)).toThrow('toJSON');
  });

  it('rejects nested object with toJSON', () => {
    const obj = { data: { name: 'test', toJSON: () => 'override' } };
    expect(() => validateJsonValue(obj)).toThrow('toJSON');
    expect(() => validateJsonValue(obj)).toThrow('root.data');
  });

  it('rejects array with toJSON', () => {
    const arr = [1, 2, 3] as unknown as number[] & { toJSON: () => unknown };
    (arr as Record<string, unknown>).toJSON = () => 'arr';
    expect(() => validateJsonValue(arr)).toThrow('toJSON');
  });
});

// ─── Custom prototype rejection ───────────────────────────────────

describe('validateJsonValue — custom prototype', () => {
  it('rejects object with custom prototype', () => {
    class Custom {
      name = 'test';
    }
    expect(() => validateJsonValue(new Custom())).toThrow('自定义原型');
  });

  it('rejects Date (custom prototype)', () => {
    expect(() => validateJsonValue(new Date())).toThrow('自定义原型');
  });

  it('rejects Map (custom prototype)', () => {
    expect(() => validateJsonValue(new Map())).toThrow('自定义原型');
  });

  it('rejects Array subclass', () => {
    class MyArray extends Array {}
    const arr = new MyArray(1, 2, 3);
    expect(() => validateJsonValue(arr)).toThrow('Array 子类');
  });
});

// ─── Circular reference detection ─────────────────────────────────

describe('validateJsonValue — circular reference', () => {
  it('rejects circular reference in object', () => {
    const obj: Record<string, unknown> = { name: 'test' };
    obj.self = obj;
    expect(() => validateJsonValue(obj)).toThrow('循环引用');
  });

  it('rejects circular reference in array', () => {
    const arr: unknown[] = [1, 2];
    arr.push(arr);
    expect(() => validateJsonValue(arr)).toThrow('循环引用');
  });

  it('rejects ancestor chain circular reference', () => {
    const child: Record<string, unknown> = { name: 'child' };
    const parent: Record<string, unknown> = { name: 'parent', child };
    child.parent = parent;
    expect(() => validateJsonValue(parent)).toThrow('循环引用');
  });

  it('allows shared object reference (non-circular)', () => {
    const shared = { id: 1 };
    const obj = { a: shared, b: shared };
    expect(() => validateJsonValue(obj)).not.toThrow();
    // shared reference is preserved
    const result = validateJsonValue(obj) as Record<string, unknown>;
    expect(result.a).toBe(result.b);
  });

  it('allows same-primitive values in different positions', () => {
    const obj = { a: { x: 1 }, b: { x: 1 } };
    expect(() => validateJsonValue(obj)).not.toThrow();
  });
});

// ─── Symbol key rejection ─────────────────────────────────────────

describe('validateJsonValue — Symbol keys', () => {
  it('rejects Symbol key in object', () => {
    const sym = Symbol('secret');
    const obj = { [sym]: 'value', name: 'test' } as Record<string, unknown>;
    expect(() => validateJsonValue(obj)).toThrow('Symbol 键');
  });

  it('rejects Symbol key in array', () => {
    const sym = Symbol('secret');
    const arr = [1, 2, 3] as unknown as Record<symbol, unknown>;
    arr[sym] = 'extra';
    expect(() => validateJsonValue(arr)).toThrow('Symbol 键');
  });
});

// ─── Sparse array rejection ───────────────────────────────────────

describe('validateJsonValue — sparse arrays', () => {
  it('rejects sparse array with hole', () => {
    const arr = [1, , 3];
    expect(() => validateJsonValue(arr)).toThrow('空洞');
  });

  it('rejects sparse array at beginning', () => {
    const arr = new Array(3);
    arr[0] = 0; // [0, empty, empty]
    expect(() => validateJsonValue(arr)).toThrow('空洞');
  });
});

// ─── Non-canonical array index rejection ──────────────────────────

describe('validateJsonValue — non-canonical array indices', () => {
  it('rejects "01" pseudo-index', () => {
    const arr = [1, 2, 3] as unknown as Record<string, unknown>;
    arr['01'] = 'extra';
    expect(() => validateJsonValue(arr)).toThrow('非规范索引');
  });

  it('rejects "4294967295" large pseudo-index', () => {
    const arr = [1, 2, 3] as unknown as Record<string, unknown>;
    arr['4294967295'] = 'extra';
    expect(() => validateJsonValue(arr)).toThrow('非规范索引');
  });

  it('rejects string key on array', () => {
    const arr = [1, 2, 3] as unknown as Record<string, unknown>;
    arr.extra = 'extra';
    expect(() => validateJsonValue(arr)).toThrow('非规范索引');
  });
});

// ─── Accessor/getter rejection ────────────────────────────────────

describe('validateJsonValue — accessor/getter', () => {
  it('rejects object with getter property', () => {
    const obj = {
      name: 'test',
      get computed() {
        return 42;
      },
    };
    expect(() => validateJsonValue(obj)).toThrow('getter/setter');
  });

  it('rejects object with setter property', () => {
    const obj: Record<string, unknown> = {
      name: 'test',
      set computed(v: unknown) {
        /* noop */
      },
    };
    expect(() => validateJsonValue(obj)).toThrow('getter/setter');
  });

  it('rejects array element with getter', () => {
    const arr = [1, 2];
    Object.defineProperty(arr, 0, {
      get: () => 99,
      enumerable: true,
      configurable: true,
    });
    expect(() => validateJsonValue(arr)).toThrow('getter/setter');
  });

  it('does not trigger getter during descriptor inspection', () => {
    const obj = {};
    Object.defineProperty(obj, 'name', {
      get: () => 'test',
      enumerable: true,
      configurable: true,
    });
    // The getter is detected via getOwnPropertyDescriptor, not by accessing the property
    expect(() => validateJsonValue(obj)).toThrow('getter/setter');
  });
});

// ─── Non-enumerable property rejection ────────────────────────────

describe('validateJsonValue — non-enumerable properties', () => {
  it('rejects object with non-enumerable property', () => {
    const obj = { name: 'test' };
    Object.defineProperty(obj, 'hidden', {
      value: 'secret',
      enumerable: false,
      configurable: true,
    });
    expect(() => validateJsonValue(obj)).toThrow('不可枚举');
  });

  it('accepts all-enumerable object', () => {
    const obj = { a: 1, b: 2 };
    expect(() => validateJsonValue(obj)).not.toThrow();
  });
});

// ─── Path reporting ───────────────────────────────────────────────

describe('validateJsonValue — path reporting', () => {
  it('reports path for deeply nested invalid value', () => {
    const obj = {
      warehouses: [{ name: 'PH' }, { name: 'VN', data: { value: NaN } }],
    };
    expect(() => validateJsonValue(obj)).toThrow('NaN');
    expect(() => validateJsonValue(obj)).toThrow(
      'root.warehouses[1].data.value',
    );
  });

  it('reports array index path', () => {
    const arr = [1, [2, NaN]];
    expect(() => validateJsonValue(arr)).toThrow('root[1][1]');
  });
});

import { getWebAnalyticsState, parseBinding } from '../../../src/main/agent-runtime/web-analytics-sites';

const stubDb = (rows: Array<{ key: string; value: string }> | Error) => ({
  prepare: () => ({
    all: () => { if (rows instanceof Error) throw rows; return rows; },
  }),
});

describe('parseBinding', () => {
  it('reads the v0.2.0 record', () => {
    expect(parseBinding('{"property":"properties/1","displayName":"Alpha","boundAt":5}')).toEqual({
      property: 'properties/1', displayName: 'Alpha', boundAt: 5,
    });
  });

  it('reads a v0.1.0 bare property id', () => {
    // An older mapping must keep working rather than read as unbound — presenting a bound site as
    // needing setup invites a second, conflicting binding.
    expect(parseBinding('properties/447120388')).toEqual({ property: 'properties/447120388' });
  });

  it('treats an unbind as not bound', () => {
    // map_property writes an empty string rather than deleting the row.
    expect(parseBinding('')).toBeUndefined();
    expect(parseBinding('   ')).toBeUndefined();
  });

  it('treats a corrupt or property-less record as not bound', () => {
    expect(parseBinding('{not json')).toBeUndefined();
    expect(parseBinding('{"displayName":"Alpha"}')).toBeUndefined();
  });

  it('handles null and undefined', () => {
    expect(parseBinding(null)).toBeUndefined();
    expect(parseBinding(undefined)).toBeUndefined();
  });
});

describe('getWebAnalyticsState', () => {
  it('reports nothing bound without a database', () => {
    expect(getWebAnalyticsState(null)).toEqual({ bindings: {} });
  });

  it('reads as "nothing bound" when agent_state does not exist yet', () => {
    // The table is created by AgentStateStore on the first agent run. Before that it is absent,
    // and an empty result is the honest answer rather than a crashed tab.
    expect(getWebAnalyticsState(stubDb(new Error('no such table: agent_state')) as any)).toEqual({ bindings: {} });
  });

  it('keys bindings by site name', () => {
    const state = getWebAnalyticsState(stubDb([
      { key: 'ga4Property:alpineoutfitters', value: '{"property":"properties/447120388","displayName":"Alpine"}' },
      { key: 'ga4Property:jeremypollock2', value: 'properties/312998104' },
    ]) as any);
    expect(state.bindings.alpineoutfitters).toEqual({ property: 'properties/447120388', displayName: 'Alpine' });
    expect(state.bindings.jeremypollock2).toEqual({ property: 'properties/312998104' });
  });

  it('omits unbound and malformed rows rather than inventing a binding', () => {
    const state = getWebAnalyticsState(stubDb([
      { key: 'ga4Property:bound', value: 'properties/1' },
      { key: 'ga4Property:cleared', value: '' },
      { key: 'ga4Property:broken', value: '{oops' },
      { key: 'ga4Property:', value: 'properties/2' },
    ]) as any);
    expect(Object.keys(state.bindings)).toEqual(['bound']);
  });
});

describe('AgentStateStore’s encoding envelope', () => {
  // The store JSON-stringifies on set and parses on get, so an agent storing a JSON *string*
  // leaves a double-encoded column value. Reading the column directly sees a quoted string where
  // the agent sees an object — which rendered the entire blob as the property name in the UI.
  const AS_STORED = '"{\\"property\\":\\"properties/321548191\\",\\"displayName\\":\\"Advanced Custom Fields\\",\\"boundAt\\":1786305808347}"';

  it('unwraps the envelope before reading the binding', () => {
    expect(parseBinding(AS_STORED)).toEqual({
      property: 'properties/321548191',
      displayName: 'Advanced Custom Fields',
      boundAt: 1786305808347,
    });
  });

  it('unwraps an enveloped bare property id too', () => {
    expect(parseBinding('"properties/447120388"')).toEqual({ property: 'properties/447120388' });
  });

  it('treats an enveloped empty string as not bound', () => {
    // What an unbind writes, once the store has encoded it.
    expect(parseBinding('""')).toBeUndefined();
  });

  it('still reads an un-enveloped value, so a direct writer keeps working', () => {
    expect(parseBinding('{"property":"properties/1"}')).toEqual({ property: 'properties/1' });
  });

  it('rejects an envelope containing something that is not a string', () => {
    expect(parseBinding('123')).toEqual({ property: '123' });
    expect(parseBinding('"{bad json}"')).toBeUndefined();
  });
});

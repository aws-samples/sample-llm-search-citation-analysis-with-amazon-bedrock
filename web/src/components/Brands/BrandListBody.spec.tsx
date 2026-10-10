import {
  describe, expect, it
} from 'vitest';
import {
  fireEvent, screen
} from '@testing-library/react';
import {
  SKY_ANDES_EXPANSION, getNewBrandInput, renderBrandListBody
} from './BrandListBody-fixtures';

describe('BrandListBody', () => {
  it('shows the hint above the input', () => {
    renderBrandListBody({ hint: 'Click a competitor to select it.' });

    expect(screen.getByText('Click a competitor to select it.')).toBeInTheDocument();
  });

  it('gives the add-brand input its configured id, label and placeholder', () => {
    renderBrandListBody();

    const input = getNewBrandInput();

    expect([input.id, input.getAttribute('aria-label'), input.placeholder]).toStrictEqual([
      'new-first-party-brand', 'New first party brand', 'Enter brand name...',
    ]);
  });

  it('reports the typed text through onNewBrandChange', () => {
    const props = renderBrandListBody();

    fireEvent.change(getNewBrandInput(), { target: { value: 'JetPuma' } });

    expect(props.onNewBrandChange).toHaveBeenCalledWith('JetPuma');
  });

  it.each([
    ['Add is clicked', (): void => { fireEvent.click(screen.getByRole('button', { name: 'Add' })); }],
    ['Enter is pressed in the input', (): void => { fireEvent.keyDown(getNewBrandInput(), { key: 'Enter' }); }],
  ])('adds the brand when %s', (_trigger, addBrand) => {
    const props = renderBrandListBody({ newBrand: 'JetPuma' });

    addBrand();

    expect(props.onAddBrand).toHaveBeenCalledWith();
  });

  it('does not add the brand on other keys', () => {
    const props = renderBrandListBody({ newBrand: 'JetPuma' });

    fireEvent.keyDown(getNewBrandInput(), { key: 'a' });

    expect(props.onAddBrand).not.toHaveBeenCalled();
  });

  it('lists every brand as a tag', () => {
    renderBrandListBody();

    expect(screen.getByRole('button', { name: /Altiplano Air/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Condor Sur/ })).toBeInTheDocument();
  });

  it('says none are added when the list is empty', () => {
    renderBrandListBody({ brands: [] });

    expect(screen.getByText('None added')).toBeInTheDocument();
  });

  it('selects a brand when its tag is clicked', () => {
    const props = renderBrandListBody();

    fireEvent.click(screen.getByRole('button', { name: /Condor Sur/ }));

    expect(props.onSelectBrand).toHaveBeenCalledWith('Condor Sur');
  });

  it('removes a brand when its cross is clicked', () => {
    const props = renderBrandListBody({ brands: ['Aurora Airways'] });

    fireEvent.click(screen.getByText('×'));

    expect(props.onRemoveBrand).toHaveBeenCalledWith('Aurora Airways');
  });

  it('shows the sub-brand suggestions once this list was expanded', () => {
    renderBrandListBody({
      expansionResult: SKY_ANDES_EXPANSION,
      expansionTarget: 'first_party',
    });

    expect(screen.getByRole('button', { name: 'Sky Andes' })).toBeInTheDocument();
  });

  it('keeps the suggestions hidden when the other list was expanded', () => {
    renderBrandListBody({
      expansionResult: SKY_ANDES_EXPANSION,
      expansionTarget: 'competitor',
    });

    expect(screen.queryByText('Sky Andes')).not.toBeInTheDocument();
  });

  it('wires the suggestion toggles to onTogglePending', () => {
    const props = renderBrandListBody({
      expansionResult: SKY_ANDES_EXPANSION,
      expansionTarget: 'first_party',
    });

    fireEvent.click(screen.getByRole('button', { name: 'Sky Andes' }));

    expect(props.onTogglePending).toHaveBeenCalledWith('Sky Andes');
  });

  it('renders the panels passed as children', () => {
    renderBrandListBody({ children: <p>Competitors for your brands</p> });

    expect(screen.getByText('Competitors for your brands')).toBeInTheDocument();
  });

  it.each([
    ['emerald', 'border-emerald-300'],
    ['amber', 'border-amber-300'],
  ] as const)('colours the input in the %s scheme', (colorScheme, borderClass) => {
    renderBrandListBody({ colorScheme });

    expect(getNewBrandInput()).toHaveClass(borderClass);
  });
});

import {mapItem} from '../src/services/jellyfin/shared';

const base = 'https://media.example.com';

describe('mapItem card image', () => {
  it('uses the item poster when it has one', () => {
    const item = mapItem(base, 'token', {
      Id: 'ep-1',
      ImageTags: {Primary: 'ep-tag'},
      SeriesId: 'series-1',
      SeriesPrimaryImageTag: 'series-tag',
    });

    expect(item.imageUrl).toContain('/Items/ep-1/Images/Primary');
    expect(item.imageUrl).toContain('tag=ep-tag');
  });

  it('borrows the series poster for an episode without one', () => {
    const item = mapItem(base, 'token', {
      Id: 'ep-1',
      ImageTags: {},
      SeriesId: 'series-1',
      SeriesPrimaryImageTag: 'series-tag',
    });

    expect(item.imageUrl).toContain('/Items/series-1/Images/Primary');
    expect(item.imageUrl).toContain('tag=series-tag');
  });

  it('keeps asking for the item image when there is no series poster either', () => {
    const item = mapItem(base, 'token', {Id: 'movie-1'});

    expect(item.imageUrl).toContain('/Items/movie-1/Images/Primary');
  });
});

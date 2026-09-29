import { MAX_PHOTO_SIDE, fitWithin } from './image-resize';

describe('fitWithin (TICKET-036 photo resize)', () => {
  it('scales the longest side down to 1600 px, keeping the aspect ratio', () => {
    expect(MAX_PHOTO_SIDE).toBe(1600);
    expect(fitWithin(4032, 3024)).toEqual({ width: 1600, height: 1200 }); // landscape phone photo
    expect(fitWithin(3024, 4032)).toEqual({ width: 1200, height: 1600 }); // portrait
    expect(fitWithin(5000, 5000)).toEqual({ width: 1600, height: 1600 });
  });

  it('never scales up a small photo', () => {
    expect(fitWithin(800, 600)).toEqual({ width: 800, height: 600 });
    expect(fitWithin(1600, 900)).toEqual({ width: 1600, height: 900 });
  });

  it('rounds, and never goes below 1 px (a very thin panorama)', () => {
    expect(fitWithin(3333, 2000)).toEqual({ width: 1600, height: 960 });
    expect(fitWithin(100000, 10)).toEqual({ width: 1600, height: 1 });
  });

  it('takes a custom limit', () => {
    expect(fitWithin(1000, 500, 200)).toEqual({ width: 200, height: 100 });
  });
});

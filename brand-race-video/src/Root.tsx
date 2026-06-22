import { Composition } from 'remotion';
import { BrandRace } from './BrandRace';
import { FPS, TOTAL_FRAMES } from './engine';

export const RemotionRoot: React.FC = () => {
  return (
    <Composition
      id="BrandRace"
      component={BrandRace}
      durationInFrames={TOTAL_FRAMES}
      fps={FPS}
      width={1080}
      height={1350}
    />
  );
};

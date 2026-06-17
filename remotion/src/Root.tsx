import React from "react";
import { Composition } from "remotion";
import { MainVideo, MAIN_DURATION } from "./MainVideo";
import { MainVideo15s, MAIN_15_DURATION } from "./MainVideo15s";

export const RemotionRoot: React.FC = () => (
  <>
    <Composition
      id="main"
      component={MainVideo}
      durationInFrames={MAIN_DURATION}
      fps={30}
      width={1080}
      height={1920}
    />
    <Composition
      id="main15"
      component={MainVideo15s}
      durationInFrames={MAIN_15_DURATION}
      fps={30}
      width={1080}
      height={1920}
    />
  </>
);

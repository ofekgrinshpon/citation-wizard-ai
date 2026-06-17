import React from "react";
import { AbsoluteFill, Sequence } from "remotion";
import { TransitionSeries, linearTiming } from "@remotion/transitions";
import { fade } from "@remotion/transitions/fade";
import { wipe } from "@remotion/transitions/wipe";
import { Hook } from "./scenes/Hook";
import { Reveal } from "./scenes/Reveal";
import { Stage } from "./components/Stage";
import { VerifiedSources, Citation } from "./scenes/Benefits";
import { LogoScene } from "./scenes/LogoScene";

const T = 14;
const HOOK = 70;
const REVEAL = 110;
const BENEFIT = 56;
const LOGO = 90;

export const MAIN_15_DURATION = HOOK + REVEAL + BENEFIT * 2 + LOGO - T * 4;

const BenefitWrap: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <Stage>{children}</Stage>
);

export const MainVideo15s: React.FC = () => (
  <AbsoluteFill style={{ background: "#0B1220" }}>
    <TransitionSeries>
      <TransitionSeries.Sequence durationInFrames={HOOK}>
        <Hook />
      </TransitionSeries.Sequence>
      <TransitionSeries.Transition presentation={fade()} timing={linearTiming({ durationInFrames: T })} />
      <TransitionSeries.Sequence durationInFrames={REVEAL}>
        <Reveal />
      </TransitionSeries.Sequence>
      <TransitionSeries.Transition presentation={fade()} timing={linearTiming({ durationInFrames: T })} />
      <TransitionSeries.Sequence durationInFrames={BENEFIT}>
        <BenefitWrap><VerifiedSources /></BenefitWrap>
      </TransitionSeries.Sequence>
      <TransitionSeries.Transition presentation={fade()} timing={linearTiming({ durationInFrames: T })} />
      <TransitionSeries.Sequence durationInFrames={BENEFIT}>
        <BenefitWrap><Citation /></BenefitWrap>
      </TransitionSeries.Sequence>
      <TransitionSeries.Transition presentation={fade()} timing={linearTiming({ durationInFrames: T })} />
      <TransitionSeries.Sequence durationInFrames={LOGO}>
        <LogoScene />
      </TransitionSeries.Sequence>
    </TransitionSeries>
  </AbsoluteFill>
);

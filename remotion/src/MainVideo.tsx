import React from "react";
import { AbsoluteFill } from "remotion";
import { TransitionSeries, springTiming, linearTiming } from "@remotion/transitions";
import { fade } from "@remotion/transitions/fade";
import { wipe } from "@remotion/transitions/wipe";
import { Hook } from "./scenes/Hook";
import { Chaos, CHAOS_DURATION } from "./scenes/Chaos";
import { Reveal, REVEAL_DURATION } from "./scenes/Reveal";
import { Benefits, BENEFITS_DURATION } from "./scenes/Benefits";
import { Payoff, PAYOFF_DURATION } from "./scenes/Payoff";
import { LogoScene, LOGO_DURATION } from "./scenes/LogoScene";

const HOOK = 90;
const T = 18;

export const MAIN_DURATION =
  HOOK + CHAOS_DURATION + REVEAL_DURATION + BENEFITS_DURATION + PAYOFF_DURATION + LOGO_DURATION - T * 5;

export const MainVideo: React.FC = () => {
  return (
    <AbsoluteFill style={{ background: "#44b2f2" }}>
      <TransitionSeries>
        <TransitionSeries.Sequence durationInFrames={HOOK}>
          <Hook />
        </TransitionSeries.Sequence>
        <TransitionSeries.Transition presentation={wipe({ direction: "from-bottom" })} timing={linearTiming({ durationInFrames: T })} />
        <TransitionSeries.Sequence durationInFrames={CHAOS_DURATION}>
          <Chaos />
        </TransitionSeries.Sequence>
        <TransitionSeries.Transition presentation={fade()} timing={linearTiming({ durationInFrames: T })} />
        <TransitionSeries.Sequence durationInFrames={REVEAL_DURATION}>
          <Reveal />
        </TransitionSeries.Sequence>
        <TransitionSeries.Transition presentation={fade()} timing={linearTiming({ durationInFrames: T })} />
        <TransitionSeries.Sequence durationInFrames={BENEFITS_DURATION}>
          <Benefits />
        </TransitionSeries.Sequence>
        <TransitionSeries.Transition presentation={fade()} timing={linearTiming({ durationInFrames: T })} />
        <TransitionSeries.Sequence durationInFrames={PAYOFF_DURATION}>
          <Payoff />
        </TransitionSeries.Sequence>
        <TransitionSeries.Transition presentation={fade()} timing={linearTiming({ durationInFrames: T })} />
        <TransitionSeries.Sequence durationInFrames={LOGO_DURATION}>
          <LogoScene />
        </TransitionSeries.Sequence>
      </TransitionSeries>
    </AbsoluteFill>
  );
};

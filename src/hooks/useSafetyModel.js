import { useState, useEffect } from 'react';
import * as tf from '@tensorflow/tfjs';

export const useSafetyModel = () => {
  const [model, setModel] = useState(null);
  const [isTrained, setIsTrained] = useState(false);

  // 1. 모델 생성 및 학습 (앱 켜질 때 1회 실행)
  useEffect(() => {
    async function trainModel() {
      // (1) 모델 구조 정의: 입력 4개 [CCTV, 가로등, 도로폭, 밤여부]
      const newModel = tf.sequential();
      newModel.add(tf.layers.dense({ units: 16, activation: 'relu', inputShape: [4] }));
      newModel.add(tf.layers.dense({ units: 8, activation: 'relu' }));
      newModel.add(tf.layers.dense({ units: 1, activation: 'sigmoid' })); // 0~1 위험도 출력

      newModel.compile({ optimizer: 'adam', loss: 'meanSquaredError' });

      // (2) 가상 학습 데이터 생성 (규칙을 AI에게 가르침)
      const xsData = [];
      const ysData = [];

      for (let i = 0; i < 500; i++) {
        const cctv = Math.floor(Math.random() * 5); // 0~4
        const lamp = Math.floor(Math.random() * 5); // 0~4
        const width = Math.random() * 15;           // 0~15m
        const isNight = Math.random() > 0.5 ? 1 : 0;

        // [정답 규칙]
        // 기본 위험도 0.5
        // CCTV 많으면 안전(-), 좁은길 위험(+), 밤에 가로등 없으면 대박 위험(++)
        let risk = 0.5;
        risk -= (cctv * 0.1);
        if (width < 3) risk += 0.3;
        if (isNight && lamp === 0) risk += 0.4;
        else if (!isNight) risk -= 0.1;

        risk = Math.max(0, Math.min(1, risk));

        xsData.push([cctv, lamp, width, isNight]);
        ysData.push([risk]);
      }

      const xs = tf.tensor2d(xsData);
      const ys = tf.tensor2d(ysData);

      console.log("🧠 안전 AI 모델 학습 중...");
      await newModel.fit(xs, ys, { epochs: 10 });
      console.log("✅ AI 학습 완료!");

      setModel(newModel);
      setIsTrained(true);
      xs.dispose(); ys.dispose();
    }
    trainModel();
  }, []);

  // 2. 예측 함수 (길찾기 그래프 만들 때 사용)
  const predictRisk = (cctv, lamp, width) => {
    if (!model) return 0; // 모델 없으면 0

    return tf.tidy(() => {
      // 현재 시간이 밤(20시~06시)인지 확인
      const hour = new Date().getHours();
      const isNight = (hour >= 20 || hour <= 6) ? 1 : 0;

      const input = tf.tensor2d([[cctv, lamp, width, isNight]]);
      const result = model.predict(input);
      return result.dataSync()[0]; // 0.0 ~ 1.0 반환
    });
  };

  return { isTrained, predictRisk };
};
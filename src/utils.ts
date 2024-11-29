import _ from 'lodash';

function NormalizeProbabilities(probabilities: number[]): number[] {
  const total = probabilities.reduce((sum, prob) => sum + prob, 0);
  return probabilities.map(prob => prob / total);
}

export function RandomChooseWithWeights<T>(weights: number[], choices: T[]) : T {
  // 检查输入有效性
  if (choices.length !== weights.length) {
    throw new Error('weights and choices arrays must have the same length.');
  }
  // 归一化概率
  const normalizedProbabilities = NormalizeProbabilities(weights);


  // 累积概率数组
  const cumulativeProbabilities = normalizedProbabilities.reduce((acc, prob, index) => {
    acc.push((acc[index - 1] || 0) + prob);
    return acc;
  }, [] as number[]);
  
  // 生成随机数
  const random = Math.random();

  // 找到随机数对应的group
  return choices[cumulativeProbabilities.findIndex((p) => p > random)];
}

export function RandomChoose<T>(choices: T[]) : T {
  return choices[_.random(choices.length - 1)];
}
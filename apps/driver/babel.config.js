// NativeWind's documented setup. babel-preset-expo adds the worklets plugin
// for Reanimated by itself when react-native-worklets is installed.
module.exports = function (api) {
  api.cache(true);
  return {
    presets: [
      ["babel-preset-expo", { jsxImportSource: "nativewind" }],
      "nativewind/babel",
    ],
  };
};

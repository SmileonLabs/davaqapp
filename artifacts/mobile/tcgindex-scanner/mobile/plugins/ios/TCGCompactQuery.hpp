#pragma once
#include <array>
#include <algorithm>
#include <cmath>
#include <cstdint>
#include <stdexcept>
// CompactCardIndex.kt: max-absolute Float32 scaling, Kotlin ties toward +infinity.
inline std::array<std::int8_t,256> tcgCompactQuery(const float* values,std::size_t count) {
  if(count!=256)throw std::invalid_argument("Invalid compact embedding dimensions");
  float scale=0;
  for(std::size_t i=0;i<count;i++){
    if(!std::isfinite(values[i]))throw std::invalid_argument("Invalid compact embedding");
    scale=std::max(scale,std::abs(values[i]));
  }
  if(scale<=1e-8f)throw std::invalid_argument("Empty compact embedding");
  std::array<std::int8_t,256> query;
  for(std::size_t i=0;i<count;i++){
    const float scaled=values[i]/scale*127.f;
    const int rounded=static_cast<int>(std::floor(static_cast<double>(scaled)+.5));
    query[i]=static_cast<std::int8_t>(std::max(-127,std::min(127,rounded)));
  }
  return query;
}

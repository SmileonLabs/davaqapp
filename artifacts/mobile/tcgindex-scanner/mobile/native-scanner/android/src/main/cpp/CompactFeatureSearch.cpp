#include <jni.h>
#include <usearch/index_dense.hpp>
#include <array>
#include <memory>
#include <stdexcept>
#include <vector>

using DenseIndex = unum::usearch::index_dense_gt<>;
namespace {
void fail(JNIEnv* env, const char* message) {
  auto type=env->FindClass("java/lang/IllegalArgumentException");
  if(type) { env->ThrowNew(type,message ? message : "Compact search failed");env->DeleteLocalRef(type); }
}
}

extern "C" JNIEXPORT jlong JNICALL
Java_com_margelo_nitro_tcgscanner_CompactFeatureSearch_open(JNIEnv* env, jobject, jstring path) {
  try {
    const char* text = env->GetStringUTFChars(path, nullptr);
    auto state = DenseIndex::make(text, true);
    env->ReleaseStringUTFChars(path, text);
    if (!state) { fail(env,state.error.release());return 0; }
    auto index = std::make_unique<DenseIndex>(std::move(state.index));
    if (index->dimensions()!=256 || index->scalar_kind()!=unum::usearch::scalar_kind_t::i8_k ||
        index->metric().metric_kind()!=unum::usearch::metric_kind_t::cos_k || index->size()==0 || index->size()>100000)
      throw std::invalid_argument("Incompatible compact card index");
    index->change_expansion_search(64);
    return reinterpret_cast<jlong>(index.release());
  } catch (const std::exception& error) { fail(env, error.what()); return 0; }
}

extern "C" JNIEXPORT jint JNICALL
Java_com_margelo_nitro_tcgscanner_CompactFeatureSearch_count(JNIEnv*, jobject, jlong handle) {
  return handle ? static_cast<jint>(reinterpret_cast<DenseIndex*>(handle)->size()) : 0;
}

extern "C" JNIEXPORT jfloatArray JNICALL
Java_com_margelo_nitro_tcgscanner_CompactFeatureSearch_rank(JNIEnv* env, jobject, jlong handle, jbyteArray query, jint limit) {
  try {
    if (!handle || env->GetArrayLength(query)!=256 || limit<1 || limit>32)
      throw std::invalid_argument("Invalid compact search query");
    std::array<std::int8_t,256> vector;
    env->GetByteArrayRegion(query, 0, 256, reinterpret_cast<jbyte*>(vector.data()));
    auto found = reinterpret_cast<DenseIndex*>(handle)->search(vector.data(), limit);
    if (!found) {
      const char* message = found.error.release();
      throw std::runtime_error(message ? message : "Compact search failed");
    }
    std::vector<float> values;
    for (std::size_t i=0; i<found.size(); ++i) {
      const auto match = found[i]; const auto key = static_cast<std::uint64_t>(match.member.key);
      if (key>=100000) throw std::invalid_argument("Invalid card metadata key");
      values.push_back(static_cast<float>(key)); values.push_back(1.f-match.distance);
    }
    auto result = env->NewFloatArray(values.size());
    if (result) env->SetFloatArrayRegion(result, 0, values.size(), values.data());
    return result;
  } catch (const std::exception& error) { fail(env, error.what()); return nullptr; }
}

extern "C" JNIEXPORT void JNICALL
Java_com_margelo_nitro_tcgscanner_CompactFeatureSearch_close(JNIEnv*, jobject, jlong handle) {
  delete reinterpret_cast<DenseIndex*>(handle);
}

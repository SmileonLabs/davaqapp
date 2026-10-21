#include <jni.h>
#include <algorithm>
#include <array>
#include <cstdint>
#include <cstring>
#include <vector>
#include <unordered_set>
#include <fstream>
#include <cstdio>
#include <string>

namespace {
constexpr int words = 4 * 65536;
struct Reference { const uint8_t* data; int count; };
struct Index {
  std::vector<jobject> buffers;
  std::vector<Reference> references;
  std::vector<int> starts;
  std::vector<uint32_t> postings;
};
int hash(const uint8_t* data, int table) {
  int value = 0;
  for (int i=0;i<16;++i) { int bit=(table*67+i*13)%256;value|=((data[bit/8]>>(bit%8))&1)<<i; }
  return table*65536+value;
}
uint64_t read64(const uint8_t* data) { uint64_t value;std::memcpy(&value,data,8);return value; }
int distance(const std::array<uint64_t,4>& query,const uint8_t* data) {
  return __builtin_popcountll(query[0]^read64(data))+__builtin_popcountll(query[1]^read64(data+8))+
    __builtin_popcountll(query[2]^read64(data+16))+__builtin_popcountll(query[3]^read64(data+24));
}
}
extern "C" JNIEXPORT jlong JNICALL
Java_com_margelo_nitro_tcgscanner_CardFeatureSearch_create(JNIEnv* env,jobject,jobjectArray buffers,jintArray offsets,jintArray counts,jstring cachePath,jstring cacheKey) {
  auto* index=new Index();const int count=env->GetArrayLength(buffers);
  std::vector<int> off(count),sizes(count);env->GetIntArrayRegion(offsets,0,count,off.data());env->GetIntArrayRegion(counts,0,count,sizes.data());
  index->references.reserve(count);index->starts.resize(words+1);
  std::unordered_set<const uint8_t*> mapped;
  for(int card=0;card<count;++card) {
    jobject buffer=env->GetObjectArrayElement(buffers,card);
    auto* base=static_cast<uint8_t*>(env->GetDirectBufferAddress(buffer));
    if(mapped.insert(base).second)index->buffers.push_back(env->NewGlobalRef(buffer));
    auto* data=base+off[card];
    index->references.push_back({data,sizes[card]});env->DeleteLocalRef(buffer);
  }
  const char* pathChars=env->GetStringUTFChars(cachePath,nullptr);std::string path(pathChars);env->ReleaseStringUTFChars(cachePath,pathChars);
  const char* keyChars=env->GetStringUTFChars(cacheKey,nullptr);std::string key(keyChars);env->ReleaseStringUTFChars(cacheKey,keyChars);
  // Descriptor parts are immutable. Rebind their mappings, then reuse the
  // derived postings instead of hashing the entire catalog on every app launch.
  if(!path.empty()&&key.size()==64){
    std::ifstream file(path,std::ios::binary);char savedKey[64];uint32_t savedCount=0,postingCount=0;
    file.read(savedKey,64);file.read(reinterpret_cast<char*>(&savedCount),4);file.read(reinterpret_cast<char*>(&postingCount),4);
    if(file&&std::memcmp(savedKey,key.data(),64)==0&&savedCount==static_cast<uint32_t>(count)&&postingCount<=static_cast<uint64_t>(count)*256*4){
      index->postings.resize(postingCount);
      file.read(reinterpret_cast<char*>(index->starts.data()),index->starts.size()*sizeof(int));
      file.read(reinterpret_cast<char*>(index->postings.data()),postingCount*sizeof(uint32_t));
      bool valid=file&&index->starts.front()==0&&index->starts.back()==static_cast<int>(postingCount)&&std::is_sorted(index->starts.begin(),index->starts.end());
      if(valid)for(auto encoded:index->postings){const auto card=encoded>>9,feature=encoded&511;if(card>=index->references.size()||feature>=static_cast<uint32_t>(index->references[card].count)){valid=false;break;}}
      if(valid)return reinterpret_cast<jlong>(index);
    }
    std::fill(index->starts.begin(),index->starts.end(),0);index->postings.clear();
  }
  for(const auto& ref:index->references){
    const int stride=std::max(1,(ref.count+255)/256);
    for(int point=0;point<ref.count;point+=stride)for(int table=0;table<4;++table)++index->starts[hash(ref.data+point*40+8,table)+1];
  }
  for(int word=0;word<words;++word)index->starts[word+1]+=index->starts[word];
  index->postings.resize(index->starts.back());auto cursor=index->starts;
  for(int card=0;card<count;++card) {
    const auto& ref=index->references[card];const int stride=std::max(1,(ref.count+255)/256);
    for(int point=0;point<ref.count;point+=stride)for(int table=0;table<4;++table)
      index->postings[cursor[hash(ref.data+point*40+8,table)]++]=(static_cast<uint32_t>(card)<<9)|point;
  }
  if(!path.empty()&&key.size()==64){
    const std::string pending=path+".building";std::ofstream file(pending,std::ios::binary|std::ios::trunc);
    const uint32_t savedCount=count,postingCount=index->postings.size();
    file.write(key.data(),64);file.write(reinterpret_cast<const char*>(&savedCount),4);file.write(reinterpret_cast<const char*>(&postingCount),4);
    file.write(reinterpret_cast<const char*>(index->starts.data()),index->starts.size()*sizeof(int));file.write(reinterpret_cast<const char*>(index->postings.data()),postingCount*sizeof(uint32_t));
    file.close();if(file)std::rename(pending.c_str(),path.c_str());else std::remove(pending.c_str());
  }
  return reinterpret_cast<jlong>(index);
}
extern "C" JNIEXPORT jintArray JNICALL
Java_com_margelo_nitro_tcgscanner_CardFeatureSearch_rank(JNIEnv* env,jobject,jlong handle,jbyteArray query,jint limit,jboolean expanded) {
  auto* index=reinterpret_cast<Index*>(handle);const int size=env->GetArrayLength(query);
  std::vector<uint8_t> data(size);env->GetByteArrayRegion(query,0,size,reinterpret_cast<jbyte*>(data.data()));
  const int cards=index->references.size();std::vector<int> votes(cards),stamp(cards),best(cards),touched(cards);
  for(int point=0;point<size/32;++point) {
    const uint8_t* descriptor=data.data()+point*32;
    const std::array<uint64_t,4> blocks={read64(descriptor),read64(descriptor+8),read64(descriptor+16),read64(descriptor+24)};
    int touchedCount=0;
    int nearest=257;
    for(int table=0;table<4;++table)for(int probe=0;probe<(expanded?17:1);++probe) {
      // Near hashes retain descriptors changed by illumination/compression.
      // The exact pass stays cheap; expand only after geometric verification fails.
      const int word=hash(descriptor,table)^(probe?1<<(probe-1):0),begin=index->starts[word],end=index->starts[word+1];
      if(end-begin>2500)continue;
      for(int p=begin;p<end;++p) {
        const uint32_t encoded=index->postings[p];const int card=encoded>>9,feature=encoded&511;
        const int difference=distance(blocks,index->references[card].data+feature*40+8);
        if(difference>=72)continue;
        nearest=std::min(nearest,difference);
        if(stamp[card]!=point+1){stamp[card]=point+1;best[card]=257;touched[touchedCount++]=card;}
        best[card]=std::min(best[card],difference);
      }
    }
    // Shared text/layout must not outvote the closest picture features.
    for(int i=0;i<touchedCount;++i){const int card=touched[i];if(best[card]<=nearest+4)votes[card]+=72-best[card];}
  }
  std::vector<int> order;for(int card=0;card<cards;++card)if(votes[card]>0)order.push_back(card);
  const int n=std::min(static_cast<int>(order.size()),static_cast<int>(limit));
  std::partial_sort(order.begin(),order.begin()+n,order.end(),[&](int a,int b){return votes[a]>votes[b];});
  std::vector<int> result(n*2);for(int i=0;i<n;++i){result[i*2]=order[i];result[i*2+1]=votes[order[i]];}
  jintArray out=env->NewIntArray(result.size());env->SetIntArrayRegion(out,0,result.size(),result.data());return out;
}
extern "C" JNIEXPORT void JNICALL
Java_com_margelo_nitro_tcgscanner_CardFeatureSearch_destroy(JNIEnv* env,jobject,jlong handle) {
  auto* index=reinterpret_cast<Index*>(handle);if(!index)return;
  for(auto buffer:index->buffers)env->DeleteGlobalRef(buffer);delete index;
}
extern "C" JNIEXPORT jintArray JNICALL
Java_com_margelo_nitro_tcgscanner_CardFeatureSearch_match(JNIEnv* env,jobject,jlong handle,jint card,jbyteArray query) {
  auto* index=reinterpret_cast<Index*>(handle);const auto& ref=index->references.at(card);
  const int size=env->GetArrayLength(query);std::vector<uint8_t> data(size);
  env->GetByteArrayRegion(query,0,size,reinterpret_cast<jbyte*>(data.data()));
  std::vector<int> matches;matches.reserve(ref.count*2);
  std::vector<int> closest(size/32,257), owners(size/32,-1);
  // Return only Lowe-ratio matches. Thousands of Java Mat/DMatch objects per
  // candidate are avoided; geometric verification still runs through RANSAC.
  for(int feature=0;feature<ref.count;++feature) {
    const uint8_t* descriptor=ref.data+feature*40+8;
    const std::array<uint64_t,4> blocks={read64(descriptor),read64(descriptor+8),read64(descriptor+16),read64(descriptor+24)};
    int first=257,second=257,nearest=-1;
    for(int point=0;point<size/32;++point) {
      const int difference=distance(blocks,data.data()+point*32);
      if(difference<first){second=first;first=difference;nearest=point;}else if(difference<second)second=difference;
    }
    if(first<72&&first*4<second*3&&first<closest[nearest]){closest[nearest]=first;owners[nearest]=feature;}
  }
  // Pyramid copies of a feature are not independent geometric evidence.
  std::vector<std::pair<int,int>> unique;
  for(int point=0;point<size/32;++point)if(owners[point]>=0)unique.emplace_back(owners[point],point);
  std::sort(unique.begin(),unique.end());
  for(const auto& pair:unique){matches.push_back(pair.first);matches.push_back(pair.second);}
  jintArray out=env->NewIntArray(matches.size());env->SetIntArrayRegion(out,0,matches.size(),matches.data());return out;
}

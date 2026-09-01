# Samsung Life Disclosure RPA

삼성생명 공시실의 보험상품 공시 PDF를 IPA 기반으로 자동 수집하고 저장하는 UiPath 프로젝트입니다.

## 주요 구성

- `Main.xaml`: 자동화 진입점
- `Download_All_Disclosure_Documents.xaml`: 공시 문서 일괄 수집
- `Download_From_Pdf_Viewer.xaml`: PDF 뷰어 다운로드 처리
- `Scripts/`: 브라우저 UI 후보 수집 및 실행 보조 JavaScript
- `Run_SamsungLife_Bulk_Download.ps1`: 일괄 실행 스크립트

## 보안 및 저장소 정책

- API 키와 자격증명은 프로젝트 파일에 직접 저장하지 않습니다.
- 실행 증적, 화면 캡처, 다운로드한 PDF 및 로컬 UiPath 캐시는 Git에서 제외합니다.
- 실행 시 필요한 LLM API 설정은 외부 입력 또는 안전한 자격증명 저장소를 통해 전달합니다.

## 실행 전 확인

UiPath Studio에서 `project.json`을 열고 필요한 패키지를 복원한 후, 실행 환경에 맞는 입력 인자와 저장 경로를 설정합니다.

pipeline {
    agent any

    environment {
        NODE_VERSION = '18'
        DOCKER_REGISTRY = 'your-registry.com'
        DOCKER_IMAGE = 'microservices-ecommerce'
        KUBECONFIG = credentials('kubeconfig')
    }

    stages {
        stage('Checkout') {
            steps {
                checkout scm
            }
        }

        stage('Setup Node.js & pnpm') {
            steps {
                script {
                    sh """
                        echo 'Setting up Node.js & pnpm environment'
                        node --version
                        pnpm --version || npm install -g pnpm
                    """
                }
            }
        }

        stage('Install Dependencies') {
            steps {
                sh 'pnpm install --frozen-lockfile'
            }
        }

        stage('Lint') {
            steps {
                sh 'pnpm run lint'
            }
        }

        stage('Type Check') {
            steps {
                sh 'pnpm -r run type-check || pnpm -r exec tsc --noEmit'
            }
        }

        stage('Test') {
            parallel {
                stage('Unit Tests') {
                    steps {
                        sh 'pnpm run test'
                    }
                }
                stage('Integration Tests') {
                    steps {
                        sh 'pnpm run test'
                    }
                }
            }
            post {
                always {
                    publishTestResults testResultsPattern: '**/test-results.xml'
                    publishCoverage adapters: [coberturaAdapter('coverage/cobertura-coverage.xml')], sourceFileResolver: sourceFiles('STORE_LAST_BUILD')
                }
            }
        }

        stage('Build') {
            steps {
                sh 'pnpm run build'
            }
        }

        stage('Security Scan') {
            steps {
                sh 'pnpm audit --audit-level moderate || true'
            }
        }

        stage('Docker Build') {
            when {
                anyOf {
                    branch 'main'
                    branch 'develop'
                }
            }
            parallel {
                stage('API Gateway') {
                    steps {
                        script {
                            docker.build("${DOCKER_REGISTRY}/${DOCKER_IMAGE}/api-gateway:${BUILD_NUMBER}", "-f packages/api-gateway/Dockerfile .")
                        }
                    }
                }
                stage('User Service') {
                    steps {
                        script {
                            docker.build("${DOCKER_REGISTRY}/${DOCKER_IMAGE}/user-service:${BUILD_NUMBER}", "-f packages/ms-user/Dockerfile .")
                        }
                    }
                }
                stage('Product Service') {
                    steps {
                        script {
                            docker.build("${DOCKER_REGISTRY}/${DOCKER_IMAGE}/product-service:${BUILD_NUMBER}", "-f packages/ms-product/Dockerfile .")
                        }
                    }
                }
                stage('Order Service') {
                    steps {
                        script {
                            docker.build("${DOCKER_REGISTRY}/${DOCKER_IMAGE}/order-service:${BUILD_NUMBER}", "-f packages/ms-order/Dockerfile .")
                        }
                    }
                }
                stage('Frontend') {
                    steps {
                        script {
                            docker.build("${DOCKER_REGISTRY}/${DOCKER_IMAGE}/frontend:${BUILD_NUMBER}", "-f packages/frontend/Dockerfile .")
                        }
                    }
                }
            }
        }

        stage('Deploy to Staging') {
            when {
                branch 'develop'
            }
            steps {
                script {
                    withKubeConfig([credentialsId: 'kubeconfig']) {
                        sh """
                            kubectl set image deployment/api-gateway api-gateway=${DOCKER_REGISTRY}/${DOCKER_IMAGE}/api-gateway:${BUILD_NUMBER} -n staging
                            kubectl set image deployment/ms-user ms-user=${DOCKER_REGISTRY}/${DOCKER_IMAGE}/ms-user:${BUILD_NUMBER} -n staging
                            kubectl set image deployment/ms-product ms-product=${DOCKER_REGISTRY}/${DOCKER_IMAGE}/ms-product:${BUILD_NUMBER} -n staging
                            kubectl set image deployment/ms-order ms-order=${DOCKER_REGISTRY}/${DOCKER_IMAGE}/ms-order:${BUILD_NUMBER} -n staging
                            kubectl set image deployment/frontend frontend=${DOCKER_REGISTRY}/${DOCKER_IMAGE}/frontend:${BUILD_NUMBER} -n staging

                            kubectl rollout status deployment/api-gateway -n staging
                            kubectl rollout status deployment/ms-user -n staging
                            kubectl rollout status deployment/ms-product -n staging
                            kubectl rollout status deployment/ms-order -n staging
                            kubectl rollout status deployment/frontend -n staging
                        """
                    }
                }
            }
        }

        stage('Deploy to Production') {
            when {
                branch 'main'
            }
            input {
                message "Deploy to production?"
            }
            steps {
                script {
                    withKubeConfig([credentialsId: 'kubeconfig']) {
                        sh """
                            kubectl set image deployment/api-gateway api-gateway=${DOCKER_REGISTRY}/${DOCKER_IMAGE}/api-gateway:${BUILD_NUMBER} -n production
                            kubectl set image deployment/ms-user ms-user=${DOCKER_REGISTRY}/${DOCKER_IMAGE}/ms-user:${BUILD_NUMBER} -n production
                            kubectl set image deployment/ms-product ms-product=${DOCKER_REGISTRY}/${DOCKER_IMAGE}/ms-product:${BUILD_NUMBER} -n production
                            kubectl set image deployment/ms-order ms-order=${DOCKER_REGISTRY}/${DOCKER_IMAGE}/ms-order:${BUILD_NUMBER} -n production
                            kubectl set image deployment/frontend frontend=${DOCKER_REGISTRY}/${DOCKER_IMAGE}/frontend:${BUILD_NUMBER} -n production

                            kubectl rollout status deployment/api-gateway -n production
                            kubectl rollout status deployment/ms-user -n production
                            kubectl rollout status deployment/ms-product -n production
                            kubectl rollout status deployment/ms-order -n production
                            kubectl rollout status deployment/frontend -n production
                        """
                    }
                }
            }
        }
    }

    post {
        always {
            cleanWs()
        }
        success {
            slackSend(
                color: 'good',
                message: "✅ Pipeline succeeded for ${env.JOB_NAME} - ${env.BUILD_NUMBER}"
            )
        }
        failure {
            slackSend(
                color: 'danger',
                message: "❌ Pipeline failed for ${env.JOB_NAME} - ${env.BUILD_NUMBER}"
            )
        }
    }
}